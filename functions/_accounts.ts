import {
  isCollectionObject,
  isInternalKey,
  textResponse,
} from "./api/_apikey";
import {
  AuthenticatedPrincipal,
  UserRole,
  getStoredUser,
  isValidUsername,
  scopeStoragePath,
  unscopeStoragePath,
} from "./_users";

export const STATS_OBJECT_CAP = 5000;
export const AVATARS_PREFIX = "_$flaredrive$/avatars/";

const PRESET_ID_RE = /^preset-(0[1-9]|1[0-2])$/;

export type AccountStats = {
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
};

export type TreeChild = {
  name: string;
  key: string;
  isDir: boolean;
  size: number;
};

export type TreeListing = {
  children: TreeChild[];
  summary: AccountStats;
};

interface AccountsEnv {
  BUCKET: R2Bucket;
  WEBDAV_USERNAME: string;
}

export function avatarObjectKey(username: string): string {
  return `${AVATARS_PREFIX}${username}`;
}

export function isAllowedPresetId(id: string): boolean {
  return PRESET_ID_RE.test(id);
}

export function canManageAccount(
  principal: AuthenticatedPrincipal,
  username: string
): boolean {
  return principal.role === "admin" || principal.username === username;
}

export async function resolveTargetHome(
  username: string,
  env: AccountsEnv,
  _principal: AuthenticatedPrincipal
): Promise<{ homePrefix: string; role: UserRole } | Response> {
  if (!isValidUsername(username)) {
    return textResponse("Bad Request", 400);
  }

  const stored = await getStoredUser(env.BUCKET, username);
  if (stored) {
    return {
      homePrefix: stored.role === "admin" ? "" : `homes/${username}/`,
      role: stored.role,
    };
  }

  if (username === env.WEBDAV_USERNAME) {
    return { homePrefix: "", role: "admin" };
  }

  return textResponse("Not Found", 404);
}

function isDirectoryMarker(object: R2Object): boolean {
  return isCollectionObject(object);
}

export async function summarizePrefix(
  bucket: R2Bucket,
  prefix: string
): Promise<AccountStats> {
  let fileCount = 0;
  let totalBytes = 0;
  let truncated = false;
  let scanned = 0;
  let cursor: string | undefined;

  do {
    const listing = await bucket.list({
      prefix: prefix || undefined,
      cursor,
      // Include metadata so directory markers can be skipped.
      include: ["httpMetadata", "customMetadata"],
    });

    for (const object of listing.objects) {
      // Every listed object charges the scan budget (Workers Free), including
      // internal `_$flaredrive$/` keys. Only non-internal files count in totals.
      if (scanned >= STATS_OBJECT_CAP) {
        truncated = true;
        break;
      }
      scanned += 1;
      if (isInternalKey(object.key)) continue;
      if (isDirectoryMarker(object)) continue;
      fileCount += 1;
      totalBytes += Number(object.size) || 0;
    }

    if (truncated) break;
    if (!listing.truncated) break;
    cursor = listing.cursor;
  } while (true);

  return { fileCount, totalBytes, truncated };
}

function resolveStorageKey(
  storagePrefix: string,
  logicalPath: string
): string | null {
  if (logicalPath.includes("\0")) return null;
  const parts = logicalPath.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) return null;

  if (!storagePrefix) {
    return parts.join("/");
  }
  return scopeStoragePath(storagePrefix, logicalPath);
}

function listPrefixFor(storageKey: string, storagePrefix: string): string | undefined {
  if (storageKey) return `${storageKey}/`;
  if (storagePrefix) {
    const root = storagePrefix.replace(/\/$/, "");
    return root ? `${root}/` : undefined;
  }
  return undefined;
}

export async function listTreeChildren(
  bucket: R2Bucket,
  storagePrefix: string,
  logicalPath: string
): Promise<TreeListing> {
  const storageKey = resolveStorageKey(storagePrefix, logicalPath);
  if (storageKey === null) {
    return {
      children: [],
      summary: { fileCount: 0, totalBytes: 0, truncated: false },
    };
  }

  const listPrefix = listPrefixFor(storageKey, storagePrefix);
  const summary = await summarizePrefix(bucket, listPrefix ?? "");

  const childrenByKey = new Map<string, TreeChild>();
  let cursor: string | undefined;

  do {
    const listing = await bucket.list({
      prefix: listPrefix,
      delimiter: "/",
      cursor,
      include: ["httpMetadata", "customMetadata"],
    });

    for (const object of listing.objects) {
      if (isInternalKey(object.key)) continue;
      const logicalKey = unscopeStoragePath(storagePrefix, object.key);
      if (!logicalKey) continue;
      const name = logicalKey.split("/").pop() || logicalKey;
      const isDir = isDirectoryMarker(object);
      childrenByKey.set(logicalKey, {
        name,
        key: logicalKey,
        isDir,
        size: isDir ? 0 : Number(object.size) || 0,
      });
    }

    for (const delimited of listing.delimitedPrefixes) {
      if (isInternalKey(delimited)) continue;
      const withoutSlash = delimited.replace(/\/$/, "");
      const logicalKey = unscopeStoragePath(storagePrefix, withoutSlash);
      if (!logicalKey) continue;
      const name = logicalKey.split("/").pop() || logicalKey;
      const existing = childrenByKey.get(logicalKey);
      if (existing) {
        existing.isDir = true;
        existing.size = 0;
      } else {
        childrenByKey.set(logicalKey, {
          name,
          key: logicalKey,
          isDir: true,
          size: 0,
        });
      }
    }

    if (!listing.truncated) break;
    cursor = listing.cursor;
  } while (true);

  const children = [...childrenByKey.values()].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { children, summary };
}
