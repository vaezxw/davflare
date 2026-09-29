import { jsonResponse, textResponse } from "./_apikey";
import { resolveTargetHome, summarizePrefix } from "../_accounts";
import {
  AuthenticatedPrincipal,
  PublicUser,
  UserAvatar,
  authenticateBasicPrincipal,
  getStoredUser,
  isValidUsername,
  listStoredUsers,
  toPublicUser,
} from "../_users";

interface AccountsEnv {
  BUCKET: R2Bucket;
  WEBDAV_USERNAME: string;
  WEBDAV_PASSWORD: string;
}

export type AccountProfile = PublicUser & {
  avatarUrl: string | null;
  stats: { fileCount: number; totalBytes: number; truncated: boolean };
};

function avatarUrlFor(username: string, avatar: UserAvatar | null): string | null {
  return avatar?.kind === "upload" ? `/api/accounts/${username}/avatar` : null;
}

async function toAccountProfile(
  user: PublicUser,
  env: AccountsEnv,
  principal: AuthenticatedPrincipal
): Promise<AccountProfile> {
  const home = await resolveTargetHome(user.username, env, principal);
  const homePrefix =
    home instanceof Response
      ? user.role === "admin"
        ? ""
        : `homes/${user.username}/`
      : home.homePrefix;
  const stats = await summarizePrefix(env.BUCKET, homePrefix);
  return {
    ...user,
    avatarUrl: avatarUrlFor(user.username, user.avatar),
    stats,
  };
}

export const onRequestGet: PagesFunction<AccountsEnv> = async (context) => {
  const principal = await authenticateBasicPrincipal(
    context.request,
    context.env.BUCKET,
    context.env.WEBDAV_USERNAME,
    context.env.WEBDAV_PASSWORD
  );
  if (!principal) return textResponse("Unauthorized", 401);

  if (principal.role !== "admin") {
    const stored = await getStoredUser(context.env.BUCKET, principal.username);
    const self: PublicUser = stored
      ? toPublicUser(stored)
      : {
          username: principal.username,
          role: principal.role,
          disabled: false,
          avatar: null,
        };
    const profile = await toAccountProfile(self, context.env, principal);
    return jsonResponse({ accounts: [profile] });
  }

  const stored = await listStoredUsers(context.env.BUCKET);
  const users: PublicUser[] = stored.map(toPublicUser);
  const bootstrap = context.env.WEBDAV_USERNAME;
  if (isValidUsername(bootstrap) && !users.some((user) => user.username === bootstrap)) {
    users.unshift({ username: bootstrap, role: "admin", disabled: false, avatar: null });
  }
  users.sort((a, b) => a.username.localeCompare(b.username));

  const accounts: AccountProfile[] = [];
  for (const user of users) {
    accounts.push(await toAccountProfile(user, context.env, principal));
  }
  return jsonResponse({ accounts });
};
