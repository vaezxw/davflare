import { authFetch } from "./auth";
import { translate } from "./strings";

export type UserAvatar = { kind: "preset" | "upload"; value: string };

export type AccountProfile = {
  username: string;
  role: "admin" | "user";
  disabled: boolean;
  avatar: UserAvatar | null;
  avatarUrl: string | null;
  stats: { fileCount: number; totalBytes: number; truncated: boolean };
};

export type TreeChild = {
  name: string;
  key: string;
  isDir: boolean;
  size: number;
};

export type TreeResponse = {
  path: string;
  summary: { fileCount: number; totalBytes: number; truncated: boolean };
  children: TreeChild[];
};

async function readError(response: Response, fallback: string) {
  return (await response.text()) || fallback;
}

export async function listAccountProfiles(): Promise<AccountProfile[]> {
  const response = await authFetch("/api/accounts");
  if (!response.ok) {
    throw new Error(await readError(response, translate("loadUsersFailed")));
  }
  const body = (await response.json()) as { accounts: AccountProfile[] };
  return body.accounts;
}

export async function fetchAccountTree(
  username: string,
  path: string
): Promise<TreeResponse> {
  const params = new URLSearchParams({ path });
  const response = await authFetch(
    `/api/accounts/${encodeURIComponent(username)}/tree?${params.toString()}`
  );
  if (!response.ok) {
    throw new Error(await readError(response, translate("requestFailed")));
  }
  return response.json();
}

export async function setAccountAvatarPreset(
  username: string,
  presetId: string
): Promise<void> {
  const response = await authFetch(
    `/api/accounts/${encodeURIComponent(username)}/avatar`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "preset", value: presetId }),
    }
  );
  if (!response.ok) {
    throw new Error(await readError(response, translate("requestFailed")));
  }
}

export async function uploadAccountAvatar(
  username: string,
  blob: Blob
): Promise<void> {
  const contentType = blob.type || "application/octet-stream";
  const response = await authFetch(
    `/api/accounts/${encodeURIComponent(username)}/avatar`,
    {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    }
  );
  if (!response.ok) {
    throw new Error(await readError(response, translate("requestFailed")));
  }
}

export async function clearAccountAvatar(username: string): Promise<void> {
  const response = await authFetch(
    `/api/accounts/${encodeURIComponent(username)}/avatar`,
    { method: "DELETE" }
  );
  if (!response.ok) {
    throw new Error(await readError(response, translate("requestFailed")));
  }
}
