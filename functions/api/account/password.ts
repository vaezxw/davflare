import { jsonResponse, textResponse } from "../_apikey";
import {
  MIN_PASSWORD_LENGTH,
  authenticateBasicPrincipal,
  createStoredUser,
  getStoredUser,
  putStoredUser,
  verifyStoredUserPassword,
} from "../../_users";

interface AccountEnv {
  BUCKET: R2Bucket;
  WEBDAV_USERNAME: string;
  WEBDAV_PASSWORD: string;
}

export const onRequestPost: PagesFunction<AccountEnv> = async (context) => {
  const { request, env } = context;
  const principal = await authenticateBasicPrincipal(
    request,
    env.BUCKET,
    env.WEBDAV_USERNAME,
    env.WEBDAV_PASSWORD
  );
  if (!principal) return textResponse("Unauthorized", 401);

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return textResponse("Bad Request", 400);
  }
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return textResponse("Password is too short", 400);
  }

  const stored = await getStoredUser(env.BUCKET, principal.username);
  const currentMatches = stored
    ? await verifyStoredUserPassword(stored, currentPassword)
    : principal.username === env.WEBDAV_USERNAME && currentPassword === env.WEBDAV_PASSWORD;
  if (!currentMatches) return textResponse("Current password is wrong", 400);

  try {
    await putStoredUser(
      env.BUCKET,
      await createStoredUser(principal.username, newPassword, {
        role: stored?.role ?? principal.role,
        disabled: stored?.disabled ?? false,
        avatar: stored?.avatar,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to change password";
    return textResponse(message, 500);
  }
  return jsonResponse({ username: principal.username });
};
