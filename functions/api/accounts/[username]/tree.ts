import { jsonResponse, textResponse } from "../../_apikey";
import {
  canManageAccount,
  listTreeChildren,
  resolveTargetHome,
} from "../../../_accounts";
import {
  authenticateBasicPrincipal,
  isValidUsername,
} from "../../../_users";

interface TreeEnv {
  BUCKET: R2Bucket;
  WEBDAV_USERNAME: string;
  WEBDAV_PASSWORD: string;
}

function paramUsername(params: Record<string, string | string[]>): string {
  const value = params.username;
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

/** Reject traversal, NUL, and absolute (leading /) paths. Empty = home root. */
function parseTreePath(raw: string | null): string | Response {
  const path = raw ?? "";
  if (path.includes("\0") || path.startsWith("/")) {
    return textResponse("Bad Request", 400);
  }
  const parts = path.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) {
    return textResponse("Bad Request", 400);
  }
  return parts.join("/");
}

export const onRequestGet: PagesFunction<TreeEnv> = async (context) => {
  const { request, env, params } = context;
  const principal = await authenticateBasicPrincipal(
    request,
    env.BUCKET,
    env.WEBDAV_USERNAME,
    env.WEBDAV_PASSWORD
  );
  if (!principal) return textResponse("Unauthorized", 401);

  const username = paramUsername(params);
  if (!isValidUsername(username)) return textResponse("Bad Request", 400);
  if (!canManageAccount(principal, username)) {
    return textResponse("Forbidden", 403);
  }

  const home = await resolveTargetHome(username, env, principal);
  if (home instanceof Response) return home;

  const url = new URL(request.url);
  const path = parseTreePath(url.searchParams.get("path"));
  if (path instanceof Response) return path;

  const listing = await listTreeChildren(env.BUCKET, home.homePrefix, path);
  return jsonResponse({
    path,
    summary: listing.summary,
    children: listing.children,
  });
};
