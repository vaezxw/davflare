import { jsonResponse, textResponse } from "./_apikey";
import {
  MIN_PASSWORD_LENGTH,
  PublicUser,
  authenticateBasicPrincipal,
  createStoredUser,
  getStoredUser,
  isValidUsername,
  listStoredUsers,
  putStoredUser,
  toPublicUser,
} from "../_users";

interface UsersEnv {
  BUCKET: R2Bucket;
  WEBDAV_USERNAME: string;
  WEBDAV_PASSWORD: string;
}

async function requireAdmin(request: Request, env: UsersEnv) {
  const principal = await authenticateBasicPrincipal(
    request,
    env.BUCKET,
    env.WEBDAV_USERNAME,
    env.WEBDAV_PASSWORD
  );
  if (!principal) return textResponse("Unauthorized", 401);
  if (principal.role !== "admin") return textResponse("Forbidden", 403);
  return principal;
}

export const onRequestGet: PagesFunction<UsersEnv> = async (context) => {
  const admin = await requireAdmin(context.request, context.env);
  if (admin instanceof Response) return admin;
  const stored = await listStoredUsers(context.env.BUCKET);
  const users: PublicUser[] = stored.map(toPublicUser);
  const bootstrap = context.env.WEBDAV_USERNAME;
  if (isValidUsername(bootstrap) && !users.some((user) => user.username === bootstrap)) {
    users.unshift({ username: bootstrap, role: "admin", disabled: false });
  }
  users.sort((a, b) => a.username.localeCompare(b.username));
  return jsonResponse({ users });
};

export const onRequestPost: PagesFunction<UsersEnv> = async (context) => {
  const admin = await requireAdmin(context.request, context.env);
  if (admin instanceof Response) return admin;
  let body: { username?: unknown; password?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return textResponse("Bad Request", 400);
  }
  const username =
    typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!isValidUsername(username)) {
    return textResponse("Invalid username", 400);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return textResponse("Password is too short", 400);
  }
  if (username === context.env.WEBDAV_USERNAME || (await getStoredUser(context.env.BUCKET, username))) {
    return textResponse("User exists", 409);
  }
  try {
    const user = await createStoredUser(username, password, { role: "user" });
    await putStoredUser(context.env.BUCKET, user);
    return jsonResponse(toPublicUser(user), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create user";
    return textResponse(message, 500);
  }
};

export const onRequestPatch: PagesFunction<UsersEnv> = async (context) => {
  const admin = await requireAdmin(context.request, context.env);
  if (admin instanceof Response) return admin;
  let body: { username?: unknown; action?: unknown; password?: unknown; disabled?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return textResponse("Bad Request", 400);
  }
  const username = typeof body.username === "string" ? body.username : "";
  const stored = await getStoredUser(context.env.BUCKET, username);
  if (!stored) return textResponse("Not Found", 404);

  if (body.action === "reset-password") {
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < MIN_PASSWORD_LENGTH) return textResponse("Password is too short", 400);
    const next = await createStoredUser(stored.username, password, {
      role: stored.role,
      disabled: stored.disabled,
    });
    await putStoredUser(context.env.BUCKET, next);
    return jsonResponse(toPublicUser(next));
  }

  if (body.action === "set-disabled") {
    if (stored.role === "admin" && body.disabled === true) {
      return textResponse("Cannot disable an administrator", 400);
    }
    const next = { ...stored, disabled: body.disabled === true };
    await putStoredUser(context.env.BUCKET, next);
    return jsonResponse(toPublicUser(next));
  }
  return textResponse("Bad Request", 400);
};
