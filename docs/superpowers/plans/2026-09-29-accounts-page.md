# Accounts Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `#/accounts` list + `#/accounts/<user>` detail with lazy file tree, stats, and preset/upload avatars (admin sees all; users see self).

**Architecture:** Extend `StoredUser` with optional `avatar`; add `functions/_accounts.ts` helpers (authz, home prefix, capped stats, tree listing); Pages Functions under `/api/accounts*`; React views wired through existing hash router and Header/ExplorerBar navigation. Settings keeps create-user and links out to Accounts.

**Tech Stack:** Cloudflare Pages Functions + R2, React + MUI, Vitest, existing `authenticateBasicPrincipal` / `authFetch` patterns.

**Spec:** `docs/superpowers/specs/2026-09-29-accounts-page-design.md`

## Global Constraints

- Workers Free CPU: no full-tree CPU work; R2 `list` only; PBKDF2 stays at 5_000 iterations.
- Stats / recursive summary hard cap: `STATS_OBJECT_CAP = 5000` objects; set `truncated: true` when hit.
- Internal keys under `_$flaredrive$/` never appear in trees or stats.
- Avatar upload max body: `512 * 1024` bytes; types `image/jpeg`, `image/png`, `image/webp`.
- Avatar object key: `_$flaredrive$/avatars/<username>` (no extension; Content-Type on object).
- Preset ids: exactly `preset-01` … `preset-12` (validate with `/^preset-(0[1-9]|1[0-2])$/`).
- Username path params must pass `isValidUsername` or 400.
- Path query for tree: reject `..`, `\0`, and absolute `/`-leading after normalize; empty = account home root.
- Copy: add zh/en keys to `src/app/stringsDictionary.ts` (no hard-coded user-facing Chinese in JSX except via `strings`).

## File map

| File | Responsibility |
| --- | --- |
| `functions/_users.ts` | Add `UserAvatar` on `StoredUser` / `PublicUser`; preserve avatar on password recreate |
| `functions/_accounts.ts` | Authz, home prefix for target user, stats scan, one-level tree, avatar key helpers |
| `functions/api/accounts.ts` | `GET /api/accounts` |
| `functions/api/accounts/[username]/tree.ts` | `GET .../tree?path=` |
| `functions/api/accounts/[username]/avatar.ts` | `GET`/`PUT`/`DELETE` avatar |
| `src/app/accountProfiles.ts` | Client fetch helpers + types + preset metadata |
| `src/app/avatarPresets.ts` | Preset id → color/label |
| `src/AccountsView.tsx` | List table |
| `src/AccountDetailView.tsx` | Detail + avatar dialog + tree table |
| `src/UserAvatar.tsx` | Shared avatar renderer |
| `src/app/route.ts` | `accounts` / `account` routes |
| `src/Main.tsx`, `ExplorerBar.tsx`, `Header.tsx`, `App.tsx`, `MobileNav` if needed | Navigation wiring |
| `src/SettingsView.tsx` | Remove list; keep create + link |
| Tests under `src/app/__tests__/` | API + route + UI smoke |

---

### Task 1: User model — avatar field + preserve on password rewrite

**Files:**
- Modify: `functions/_users.ts`
- Modify: `functions/api/users.ts` (reset-password / createStoredUser callers that currently drop avatar)
- Test: `src/app/__tests__/serverUsers.test.ts`

**Interfaces:**
- Produces:
  - `export type UserAvatar = { kind: "preset" | "upload"; value: string };`
  - `StoredUser.avatar?: UserAvatar`
  - `PublicUser.avatar: UserAvatar | null`
  - `toPublicUser` includes `avatar: user.avatar ?? null`
  - `createStoredUser(..., options?: { role; disabled?; avatar? })` copies `avatar` when provided
  - `isStoredUser` accepts missing avatar; if present requires valid shape

- [ ] **Step 1: Write the failing test**

Add to `serverUsers.test.ts`:

```ts
test("preserves avatar when rewriting password hash", async () => {
  const first = await createStoredUser("alice", "old-password", {
    role: "user",
    avatar: { kind: "preset", value: "preset-03" },
  });
  expect(toPublicUser(first).avatar).toEqual({ kind: "preset", value: "preset-03" });
  const next = await createStoredUser("alice", "new-password", {
    role: first.role,
    disabled: first.disabled,
    avatar: first.avatar,
  });
  expect(next.avatar).toEqual({ kind: "preset", value: "preset-03" });
  expect(JSON.stringify(next)).not.toContain("new-password");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/__tests__/serverUsers.test.ts -t "preserves avatar"`
Expected: FAIL (avatar option / field missing)

- [ ] **Step 3: Implement model**

In `functions/_users.ts`:

```ts
export type UserAvatar = { kind: "preset" | "upload"; value: string };

export function isUserAvatar(value: unknown): value is UserAvatar {
  if (!value || typeof value !== "object") return false;
  const avatar = value as Partial<UserAvatar>;
  return (
    (avatar.kind === "preset" || avatar.kind === "upload") &&
    typeof avatar.value === "string" &&
    avatar.value.length > 0 &&
    avatar.value.length <= 128
  );
}
```

Extend `StoredUser` and `PublicUser`; update `createStoredUser` options; update `isStoredUser` to allow omitted avatar or `isUserAvatar`; `toPublicUser` returns `avatar: user.avatar ?? null`.

In `functions/api/users.ts` reset-password / any `createStoredUser` that clones a stored user, pass `avatar: stored.avatar`. Same for `functions/api/account/password.ts` when rewriting bootstrap/stored password.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/__tests__/serverUsers.test.ts src/app/__tests__/accountUsersApi.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add functions/_users.ts functions/api/users.ts functions/api/account/password.ts src/app/__tests__/serverUsers.test.ts
git commit -m "feat: store optional user avatar on account records"
```

---

### Task 2: `_accounts` helpers — home, stats, tree listing

**Files:**
- Create: `functions/_accounts.ts`
- Test: `src/app/__tests__/accountsHelpers.test.ts`

**Interfaces:**
- Consumes: `isValidUsername`, `getStoredUser`, `AuthenticatedPrincipal` from `_users`; `isInternalKey` from `api/_apikey` or duplicate `INTERNAL_PREFIX` check
- Produces:
  - `STATS_OBJECT_CAP = 5000`
  - `AVATARS_PREFIX = "_$flaredrive$/avatars/"`
  - `avatarObjectKey(username: string): string`
  - `isAllowedPresetId(id: string): boolean`
  - `resolveTargetHome(username, env, principal): Promise<{ homePrefix: string; role: UserRole } | Response>`
  - `canManageAccount(principal, username): boolean` → admin or self
  - `summarizePrefix(bucket, prefix): Promise<{ fileCount; totalBytes; truncated }>`
  - `listTreeChildren(bucket, storagePrefix, logicalPath): Promise<{ children; summary }>`

Home rules:
- Target username === bootstrap `WEBDAV_USERNAME` and no stored user → `{ homePrefix: "", role: "admin" }`
- Stored admin → `homePrefix: ""`
- Stored user → `homes/<username>/`
- Unknown username → 404 Response

`summarizePrefix`: list with `prefix`, no delimiter, skip internal keys and directory markers (`application/x-directory` / `resourcetype` collection); count files only for `fileCount`; sum `size`; stop at cap.

`listTreeChildren`:
- Storage root = `homePrefix` (may be `""`)
- Resolve `logicalPath` via same safe-parts as `scopeStoragePath` (reuse from `_users`)
- `list({ prefix: storageKey ? storageKey + "/" : undefined or home, delimiter: "/" })`
- Map children to logical keys via `unscopeStoragePath`
- Skip internal
- Dir if delimitedPrefix or collection marker
- `summary` = `summarizePrefix` under that node

- [ ] **Step 1: Failing tests** in `accountsHelpers.test.ts` using `InMemoryBucket`

```ts
test("summarizePrefix skips internal and caps", async () => { /* seed homes/alice + _$flaredrive$; expect counts */ });
test("listTreeChildren returns one level under home", async () => { /* … */ });
test("canManageAccount allows self and admin only", () => { /* … */ });
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/__tests__/accountsHelpers.test.ts`

- [ ] **Step 3: Implement `functions/_accounts.ts`**

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add functions/_accounts.ts src/app/__tests__/accountsHelpers.test.ts
git commit -m "feat: account home stats and tree listing helpers"
```

---

### Task 3: `GET /api/accounts`

**Files:**
- Create: `functions/api/accounts.ts`
- Test: `src/app/__tests__/accountsApi.test.ts`

**Interfaces:**
- Produces response `{ accounts: AccountProfile[] }` where

```ts
type AccountProfile = {
  username: string;
  role: "admin" | "user";
  disabled: boolean;
  avatar: UserAvatar | null;
  avatarUrl: string | null; // `/api/accounts/${username}/avatar` if kind===upload else null
  stats: { fileCount: number; totalBytes: number; truncated: boolean };
};
```

Auth: any principal. If role !== admin, only return self (bootstrap or stored). If admin, list like `/api/users` (stored + bootstrap) with stats each.

- [ ] **Step 1: Failing tests** — user sees only self; admin sees alice+admin; 401 without auth

- [ ] **Step 2: Run FAIL**

- [ ] **Step 3: Implement handler**

```ts
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const principal = await authenticateBasicPrincipal(/* … */);
  if (!principal) return textResponse("Unauthorized", 401);
  // build list, map with summarizePrefix(home), avatarUrl
  return jsonResponse({ accounts });
};
```

- [ ] **Step 4: PASS**

Run: `npx vitest run src/app/__tests__/accountsApi.test.ts`

- [ ] **Step 5: Commit**

```bash
git add functions/api/accounts.ts src/app/__tests__/accountsApi.test.ts
git commit -m "feat: GET /api/accounts with per-user storage stats"
```

---

### Task 4: Tree + avatar endpoints

**Files:**
- Create: `functions/api/accounts/[username]/tree.ts`
- Create: `functions/api/accounts/[username]/avatar.ts`
- Modify: `src/app/__tests__/accountsApi.test.ts` (extend) or `accountsAvatarTreeApi.test.ts`

**Interfaces:**
- `GET /api/accounts/:username/tree?path=` → `{ path, summary, children }`
- `GET /api/accounts/:username/avatar` → image bytes or 404
- `PUT` JSON preset `{ kind:"preset", value }` or raw image body
- `DELETE` clears avatar field + deletes R2 object

Authz via `canManageAccount` for mutating avatar and reading tree; `GET` avatar: same (no public anonymous).

For bootstrap admin without stored JSON: avatar PUT must `createStoredUser` with a random impossible password only if needed — **do not**. Instead: if no stored user and target is bootstrap admin, write a stored admin user by hashing a **dedicated** approach: call `putStoredUser` with `createStoredUser(bootstrap, env.WEBDAV_PASSWORD, { role: "admin", avatar })` so login still works via stored hash after first avatar set (same as password-change path). Document in code comment.

- [ ] **Step 1: Tests**

```ts
test("user cannot read other tree", async () => { expect(status).toBe(403); });
test("self tree lists homes children as logical paths", async () => { /* … */ });
test("path with .. is 400", async () => { /* … */ });
test("PUT preset then GET profile reflects it", async () => { /* … */ });
test("PUT image stores object and GET returns bytes", async () => { /* … */ });
test("invalid preset id is 400", async () => { /* … */ });
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement both route files** using `_accounts` helpers

- [ ] **Step 4: PASS**

Run: `npx vitest run src/app/__tests__/accountsApi.test.ts src/app/__tests__/accountsAvatarTreeApi.test.ts`

- [ ] **Step 5: Commit**

```bash
git add functions/api/accounts src/app/__tests__/accountsAvatarTreeApi.test.ts
git commit -m "feat: account tree listing and avatar upload APIs"
```

---

### Task 5: Client API module + presets + UserAvatar

**Files:**
- Create: `src/app/avatarPresets.ts`
- Create: `src/app/accountProfiles.ts`
- Create: `src/UserAvatar.tsx`
- Test: `src/app/__tests__/accountProfiles.test.ts` (mock `authFetch`)

**Interfaces:**

```ts
// avatarPresets.ts
export const AVATAR_PRESETS: Array<{ id: string; color: string; label: string }>; // 12 entries

// accountProfiles.ts
export type AccountProfile = { /* match API */ };
export async function listAccountProfiles(): Promise<AccountProfile[]>;
export async function fetchAccountTree(username: string, path: string): Promise<TreeResponse>;
export async function setAccountAvatarPreset(username: string, presetId: string): Promise<void>;
export async function uploadAccountAvatar(username: string, blob: Blob): Promise<void>;
export async function clearAccountAvatar(username: string): Promise<void>;

// UserAvatar.tsx
export function UserAvatar({ username, avatar, avatarUrl, size?: number }: Props): JSX.Element;
```

`UserAvatar`: if upload + avatarUrl, `<Avatar src={...}>` with `authFetch` blob URL pattern like `AuthThumbnail` **or** use `<Avatar src={avatarUrl}>` only if GET avatar accepts Basic via cookie — it does not. **Must** use authenticated blob fetch (copy `AuthThumbnail` pattern) for upload kind; for preset render colored `Avatar` with initials.

- [ ] **Step 1–4:** TDD client helpers; implement components
- [ ] **Step 5: Commit** `feat: client account profile helpers and UserAvatar`

---

### Task 6: Routes + navigation

**Files:**
- Modify: `src/app/route.ts`
- Modify: `src/app/__tests__/route.test.ts`
- Modify: `src/ExplorerBar.tsx` (`ExplorerSection` += `"accounts"`)
- Modify: `src/Header.tsx` (menu item + show `UserAvatar`)
- Modify: `src/App.tsx` / `src/Main.tsx` section mapping
- Modify: `src/app/stringsDictionary.ts` — `accounts`, `accountsTitle`, `openAccounts`, `viewAccount`, `accountFiles`, `accountTotalSize`, `changeAvatar`, `avatarPresets`, `avatarUpload`, `avatarClear`, `openInDrive`, `statsTruncated`, …

Route type:

```ts
| { kind: "accounts" }
| { kind: "account"; username: string }
```

Encode: `#/accounts`, `#/accounts/<user>`  
Decode: if raw starts with `accounts/` parse username; if exact `accounts` → list.

Main: when `route.kind === "accounts"` render `AccountsView`; `account` render `AccountDetailView`.

- [ ] **Step 1: route tests FAIL then implement**
- [ ] **Step 2: wire nav**
- [ ] **Step 3: Commit** `feat: hash routes and nav entry for accounts`

---

### Task 7: AccountsView + AccountDetailView (list, tree, avatar dialog)

**Files:**
- Create: `src/AccountsView.tsx`
- Create: `src/AccountDetailView.tsx`
- Modify: `src/Main.tsx`
- Test: `src/app/__tests__/AccountsView.test.tsx`, `AccountDetailView.test.tsx`

**List UI:** MUI `Table` — columns Avatar, Username, Role, Status, Files, Total size, Action. Format bytes with existing util if any (`formatSize` grep) else small helper.

**Detail UI:**
- Header with `UserAvatar` size 72, chips, Button “更换头像”
- Dialog: preset grid; file input accept image/*; on file selected, canvas crop square 256px → webp/jpeg blob ≤512KB; call upload
- Tree: controlled expanded Set; root row from `fetchAccountTree(user, "")`; on expand folder call `fetchAccountTree(user, key)`; indent by depth; show summary on root; truncated Alert

**Open in drive:** `navigate({ kind: "folder", path: drivePath })` where:
- viewing self → `child.key` (+ `/` if dir)
- admin viewing user U → `homes/U/${child.key}` (or `homes/U/` for root)

- [ ] **Step 1: Component tests with mocked `accountProfiles`**
- [ ] **Step 2: Implement views**
- [ ] **Step 3: Commit** `feat: accounts list and detail tree UI`

---

### Task 8: Settings slim-down + Header avatar

**Files:**
- Modify: `src/SettingsView.tsx` — remove users list / reset UI; keep create card; add Button → `onOpenAccounts?.()`
- Modify: `src/Main.tsx` — pass `onOpenAccounts={() => navigate({ kind: "accounts" })}`
- Modify: `src/Header.tsx` — load self profile avatar once (from `listAccountProfiles` first item or lightweight later); show in IconButton
- Update tests that asserted old Settings list if any

- [ ] **Step 1: Adjust Settings tests**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Commit** `feat: settings links to accounts; header shows avatar`

---

### Task 9: Verification + docs touch-up

- [ ] **Step 1: Run focused suites**

```bash
npx vitest run src/app/__tests__/serverUsers.test.ts src/app/__tests__/accountsHelpers.test.ts src/app/__tests__/accountsApi.test.ts src/app/__tests__/accountsAvatarTreeApi.test.ts src/app/__tests__/accountProfiles.test.ts src/app/__tests__/route.test.ts src/app/__tests__/AccountsView.test.tsx src/app/__tests__/AccountDetailView.test.tsx
```

Expected: all PASS

- [ ] **Step 2: Update spec status line** to `Implemented (see plan 2026-09-29-accounts-page.md)`

- [ ] **Step 3: Commit** `docs: mark accounts page spec implemented`

---

## Spec coverage checklist

| Spec item | Task |
| --- | --- |
| `#/accounts` + detail routes | 6 |
| Admin all / user self | 3, 4 |
| Lazy tree + root summary | 2, 4, 7 |
| Preset + upload avatar | 1, 4, 5, 7 |
| Avatar via API not WebDAV | 4 |
| Settings create + link | 8 |
| Header avatar | 8 |
| Stats cap / truncated | 2, 3, 7 |
| Hide `_$flaredrive$` | 2 |
| Bootstrap admin in list | 3 |

## Placeholder scan

No TBD/TODO steps; endpoints and types named consistently (`AccountProfile`, `UserAvatar`, `STATS_OBJECT_CAP`).
