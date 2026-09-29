import { authFetch, getCredentials, setCredentials } from "./auth";
import { translate } from "./strings";

export interface AccountUser {
  username: string;
  role: "admin" | "user";
  disabled: boolean;
}

async function readError(response: Response, fallback: string) {
  return (await response.text()) || fallback;
}

export async function changeOwnPassword(currentPassword: string, newPassword: string) {
  const response = await authFetch("/api/account/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) throw new Error(await readError(response, translate("passwordChangeFailed")));
  const current = getCredentials();
  if (current) setCredentials({ username: current.username, password: newPassword });
}

export async function listAccountUsers(): Promise<AccountUser[]> {
  const response = await authFetch("/api/users");
  if (!response.ok) throw new Error(await readError(response, translate("loadUsersFailed")));
  const body = (await response.json()) as { users: AccountUser[] };
  return body.users;
}

export async function createAccountUser(username: string, password: string) {
  const response = await authFetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(await readError(response, translate("createUserFailed")));
}

export async function resetAccountPassword(username: string, password: string) {
  const response = await authFetch("/api/users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, action: "reset-password", password }),
  });
  if (!response.ok) throw new Error(await readError(response, translate("resetPasswordFailed")));
}

export async function setAccountDisabled(username: string, disabled: boolean) {
  const response = await authFetch("/api/users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, action: "set-disabled", disabled }),
  });
  if (!response.ok) throw new Error(await readError(response, translate("updateUserFailed")));
}
