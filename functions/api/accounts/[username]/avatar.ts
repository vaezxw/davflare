import { jsonResponse, textResponse } from "../../_apikey";
import {
  avatarObjectKey,
  canManageAccount,
  isAllowedPresetId,
  resolveTargetHome,
} from "../../../_accounts";
import {
  UserAvatar,
  authenticateBasicPrincipal,
  createStoredUser,
  getStoredUser,
  isValidUsername,
  putStoredUser,
} from "../../../_users";

interface AvatarEnv {
  BUCKET: R2Bucket;
  WEBDAV_USERNAME: string;
  WEBDAV_PASSWORD: string;
}

const MAX_AVATAR_BYTES = 512 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function paramUsername(params: Record<string, string | string[]>): string {
  const value = params.username;
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function mimeType(request: Request): string {
  return (request.headers.get("Content-Type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

async function requireManager(
  request: Request,
  env: AvatarEnv,
  username: string
) {
  const principal = await authenticateBasicPrincipal(
    request,
    env.BUCKET,
    env.WEBDAV_USERNAME,
    env.WEBDAV_PASSWORD
  );
  if (!principal) return textResponse("Unauthorized", 401);
  if (!isValidUsername(username)) return textResponse("Bad Request", 400);
  if (!canManageAccount(principal, username)) {
    return textResponse("Forbidden", 403);
  }
  const home = await resolveTargetHome(username, env, principal);
  if (home instanceof Response) return home;
  return { principal, home };
}

async function persistAvatar(
  env: AvatarEnv,
  username: string,
  avatar: UserAvatar | undefined
): Promise<Response | void> {
  const stored = await getStoredUser(env.BUCKET, username);
  if (stored) {
    const next = { ...stored };
    if (avatar === undefined) {
      delete next.avatar;
    } else {
      next.avatar = avatar;
    }
    await putStoredUser(env.BUCKET, next);
    return;
  }

  if (username !== env.WEBDAV_USERNAME) {
    return textResponse("Not Found", 404);
  }

  // Bootstrap admin has no stored JSON yet. Persist with WEBDAV_PASSWORD hash
  // so subsequent Basic auth still works via stored digest (same as password-change path).
  if (avatar === undefined) {
    // Nothing to clear on an unsaved bootstrap admin.
    return;
  }
  await putStoredUser(
    env.BUCKET,
    await createStoredUser(username, env.WEBDAV_PASSWORD, {
      role: "admin",
      avatar,
    })
  );
}

export const onRequestGet: PagesFunction<AvatarEnv> = async (context) => {
  const username = paramUsername(context.params);
  const authz = await requireManager(context.request, context.env, username);
  if (authz instanceof Response) return authz;

  const object = await context.env.BUCKET.get(avatarObjectKey(username));
  if (!object) return textResponse("Not Found", 404);

  const headers = new Headers();
  headers.set(
    "Content-Type",
    object.httpMetadata?.contentType || "application/octet-stream"
  );
  return new Response(object.body, { status: 200, headers });
};

export const onRequestPut: PagesFunction<AvatarEnv> = async (context) => {
  const { request, env, params } = context;
  const username = paramUsername(params);
  const authz = await requireManager(request, env, username);
  if (authz instanceof Response) return authz;

  const contentType = mimeType(request);
  let avatar: UserAvatar;

  if (contentType === "application/json") {
    let body: { kind?: unknown; value?: unknown };
    try {
      body = await request.json();
    } catch {
      return textResponse("Bad Request", 400);
    }
    if (body.kind !== "preset" || typeof body.value !== "string") {
      return textResponse("Bad Request", 400);
    }
    if (!isAllowedPresetId(body.value)) {
      return textResponse("Bad Request", 400);
    }
    avatar = { kind: "preset", value: body.value };
    await env.BUCKET.delete(avatarObjectKey(username));
  } else if (ALLOWED_IMAGE_TYPES.has(contentType)) {
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return textResponse("Bad Request", 400);
    if (bytes.byteLength > MAX_AVATAR_BYTES) {
      return textResponse("Payload Too Large", 413);
    }
    await env.BUCKET.put(avatarObjectKey(username), bytes, {
      httpMetadata: { contentType },
    });
    avatar = { kind: "upload", value: username };
  } else {
    return textResponse("Bad Request", 400);
  }

  const persist = await persistAvatar(env, username, avatar);
  if (persist instanceof Response) return persist;
  return jsonResponse({ avatar });
};

export const onRequestDelete: PagesFunction<AvatarEnv> = async (context) => {
  const { request, env, params } = context;
  const username = paramUsername(params);
  const authz = await requireManager(request, env, username);
  if (authz instanceof Response) return authz;

  await env.BUCKET.delete(avatarObjectKey(username));
  const persist = await persistAvatar(env, username, undefined);
  if (persist instanceof Response) return persist;
  return jsonResponse({ avatar: null });
};
