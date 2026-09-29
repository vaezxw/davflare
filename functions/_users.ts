import { parseBasicAuthHeader, timingSafeEqual } from "./api/_apikey";

export const USERS_PREFIX = "_$flaredrive$/users/";
// Keep this low enough for Cloudflare Workers Free (≈10ms CPU/request).
// Higher counts (e.g. 210k) exceed the limit and return Error 1101.
export const PASSWORD_ITERATIONS = 10_000;

export type UserRole = "admin" | "user";

export interface StoredUser {
  version: 1;
  username: string;
  role: UserRole;
  disabled: boolean;
  password: {
    algorithm: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
    digest: string;
  };
}

export interface AuthenticatedPrincipal {
  username: string;
  role: UserRole;
  homePrefix: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    key,
    256
  );
  return new Uint8Array(bits);
}

export const MIN_PASSWORD_LENGTH = 8;

export interface PublicUser {
  username: string;
  role: UserRole;
  disabled: boolean;
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9-]+$/.test(username);
}

export function toPublicUser(user: Pick<StoredUser, "username" | "role" | "disabled">): PublicUser {
  return { username: user.username, role: user.role, disabled: user.disabled };
}

export async function createStoredUser(
  username: string,
  password: string,
  options: { role: UserRole; disabled?: boolean }
): Promise<StoredUser> {
  if (!isValidUsername(username)) throw new Error("Invalid username");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return {
    version: 1,
    username,
    role: options.role,
    disabled: options.disabled ?? false,
    password: {
      algorithm: "PBKDF2",
      hash: "SHA-256",
      iterations: PASSWORD_ITERATIONS,
      salt: bytesToBase64(salt),
      digest: bytesToBase64(digest),
    },
  };
}

export async function putStoredUser(
  bucket: R2Bucket,
  user: StoredUser
): Promise<void> {
  if (!isValidUsername(user.username)) throw new Error("Invalid username");
  await bucket.put(
    `${USERS_PREFIX}${user.username}.json`,
    JSON.stringify(user),
    { httpMetadata: { contentType: "application/json" } }
  );
}

function isStoredUser(value: unknown, username: string): value is StoredUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<StoredUser>;
  const password = user.password as Partial<StoredUser["password"]> | undefined;
  return (
    user.version === 1 &&
    user.username === username &&
    isValidUsername(user.username) &&
    (user.role === "admin" || user.role === "user") &&
    typeof user.disabled === "boolean" &&
    password?.algorithm === "PBKDF2" &&
    password.hash === "SHA-256" &&
    typeof password.iterations === "number" &&
    password.iterations > 0 &&
    typeof password.salt === "string" &&
    typeof password.digest === "string"
  );
}

export async function listStoredUsers(bucket: R2Bucket): Promise<StoredUser[]> {
  const users: StoredUser[] = [];
  let cursor: string | undefined;
  do {
    const listing = await bucket.list({ prefix: USERS_PREFIX, cursor });
    for (const object of listing.objects) {
      const username = object.key.slice(USERS_PREFIX.length).replace(/\.json$/, "");
      const user = await getStoredUser(bucket, username);
      if (user) users.push(user);
    }
    if (!listing.truncated) break;
    cursor = listing.cursor;
  } while (true);
  return users.sort((a, b) => a.username.localeCompare(b.username));
}

export async function getStoredUser(
  bucket: R2Bucket,
  username: string
): Promise<StoredUser | null> {
  if (!isValidUsername(username)) return null;
  const object = await bucket.get(`${USERS_PREFIX}${username}.json`);
  if (object === null) return null;
  try {
    const value: unknown = await object.json();
    return isStoredUser(value, username) ? value : null;
  } catch {
    return null;
  }
}

export async function verifyStoredUserPassword(
  user: StoredUser,
  password: string
): Promise<boolean> {
  try {
    const expected = base64ToBytes(user.password.digest);
    const actual = await derivePassword(
      password,
      base64ToBytes(user.password.salt),
      user.password.iterations
    );
    return timingSafeEqual(
      bytesToBase64(actual),
      bytesToBase64(expected)
    );
  } catch {
    return false;
  }
}

function principalFor(username: string, role: UserRole): AuthenticatedPrincipal {
  return {
    username,
    role,
    homePrefix: role === "admin" ? "" : `homes/${username}/`,
  };
}

export function scopeStoragePath(homePrefix: string, logicalPath: string): string | null {
  if (!homePrefix) return logicalPath;
  if (logicalPath.includes("\0")) return null;
  const parts = logicalPath.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) return null;
  const root = homePrefix.replace(/\/$/, "");
  return parts.length ? `${root}/${parts.join("/")}` : root;
}

export function unscopeStoragePath(homePrefix: string, storagePath: string): string {
  if (!homePrefix) return storagePath;
  const root = homePrefix.replace(/\/$/, "");
  if (storagePath === root) return "";
  const prefix = `${root}/`;
  return storagePath.startsWith(prefix) ? storagePath.slice(prefix.length) : storagePath;
}

export async function authenticateBasicPrincipal(
  request: Request,
  bucket: R2Bucket,
  bootstrapUsername: string,
  bootstrapPassword: string
): Promise<AuthenticatedPrincipal | null> {
  const credentials = parseBasicAuthHeader(
    request.headers.get("Authorization") || ""
  );
  if (!credentials || !isValidUsername(credentials.username)) return null;

  const key = `${USERS_PREFIX}${credentials.username}.json`;
  const storedObject = await bucket.get(key);
  if (storedObject !== null) {
    let stored: StoredUser | null = null;
    try {
      const value: unknown = await storedObject.json();
      stored = isStoredUser(value, credentials.username) ? value : null;
    } catch {
      stored = null;
    }
    if (
      !stored ||
      stored.disabled ||
      !(await verifyStoredUserPassword(stored, credentials.password))
    ) {
      return null;
    }
    return principalFor(stored.username, stored.role);
  }

  if (
    bootstrapUsername &&
    bootstrapPassword &&
    credentials.username === bootstrapUsername &&
    timingSafeEqual(credentials.password, bootstrapPassword)
  ) {
    return principalFor(credentials.username, "admin");
  }
  return null;
}
