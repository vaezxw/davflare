# Accounts management page — design

**Date:** 2026-09-29  
**Status:** Approved in chat; awaiting spec file review before implementation plan  
**Related:** multi-user homes (`homes/<user>/`), settings account cards, WebDAV jail

## Problem

Settings currently mixes feature flags, password change, create-user, and a flat account list. Admins need a dedicated place to inspect each account’s files (count + total size + expandable tree). Every user should set an avatar (preset or upload). Ordinary users must only see themselves; admins see everyone.

## Goals

- Dedicated accounts UI separate from Settings feature switches.
- List + detail with lazy directory tree (summary first, expand loads children).
- Avatars: presets + image upload; self-service; admin may change any user’s avatar.
- Respect existing home jail and Workers Free CPU limits (no full-tree scan on open).

## Non-goals

- Editing other users’ files from this page (optional “open in drive” link only).
- Real-time sync of counts while browsing elsewhere (refresh on enter / expand).
- Changing username or deleting accounts in v1 (disable/reset password stay in Settings or detail actions later).
- Custom CDN for avatars beyond existing Pages + R2.

## Decisions (from brainstorming)

| Topic | Choice |
| --- | --- |
| Access | Admin sees all; user sees only self; both can set own avatar; admin can set any avatar |
| Avatar | Presets **and** upload |
| Tree loading | Layer-by-layer lazy load; root shows file count + total size first |
| IA | Approach A — independent `#/accounts` page; Settings keeps create-user + link |

## Information architecture

### Routes

| Hash | Who | Content |
| --- | --- | --- |
| `#/accounts` | Authenticated | Account list table |
| `#/accounts/<username>` | Self or admin | Profile + avatar + lazy tree table |
| `#/settings` | Unchanged | Flags, change password, **create account** (admin), button “打开账号管理” |

### Navigation

- Add Accounts to the same secondary surfaces as Settings (ExplorerBar / MobileNav / Header account menu as appropriate).
- Non-admin hitting `#/accounts/other` → 403 UI (toast + redirect to own detail or list).

### Admin home semantics

- Stored role `admin` (and bootstrap env admin): homePrefix `""` (bucket root), same as WebDAV today.
- List row for admin shows stats for **entire bucket excluding `_$flaredrive$/`** (or document as “全部文件”); ordinary users scoped to `homes/<username>/`.
- Bootstrap admin may appear in list even before a stored user JSON exists (same pattern as `GET /api/users`).

## Data model

### Extend stored user (`_$flaredrive$/users/<username>.json`)

```ts
avatar?: {
  kind: "preset" | "upload";
  /** preset id e.g. "coral-a" | upload object id / digest */
  value: string;
};
```

Password fields unchanged. Unknown older records → treat as no avatar (UI falls back to initials + default preset).

### Avatar objects

- Uploads: `_$flaredrive$/avatars/<username>.<ext>` (overwrite on change) **or** digest-named blob + pointer in user JSON.
- Prefer: store `kind` + `value` on user; upload body at `_$flaredrive$/avatars/<username>` with content-type; GET via authenticated or short-lived public path under `/api/accounts/.../avatar` to avoid jail scoping bugs (same lesson as thumbnails).
- Presets: client-only ids (`preset-01` … `preset-12`); no R2 object.

### Public user DTO (API)

```ts
{
  username: string;
  role: "admin" | "user";
  disabled: boolean;
  avatar: { kind: "preset" | "upload"; value: string } | null;
  avatarUrl: string | null; // resolved GET URL for upload, or null for preset
  stats?: { fileCount: number; totalBytes: number; truncated?: boolean };
}
```

`stats` optional on list (compute per user with a hard object scan cap).

## API

All require Basic session via `authenticateBasicPrincipal`.

### `GET /api/accounts`

- User: return `[self]` (+ stats for home).
- Admin: all public users (incl. bootstrap if missing from store) + stats.
- Stats: scan under home prefix (admin: bucket with internal prefix skipped); cap e.g. 5_000 objects — if hit, `truncated: true` and return partial counts with UI hint.

### `GET /api/accounts/:username/tree?path=`

- `path` = logical path relative to that account’s home (empty = home root).
- Authz: caller is admin **or** `principal.username === username`.
- Response:

```ts
{
  path: string;
  summary: { fileCount: number; totalBytes: number; truncated?: boolean }; // recursive under this node, capped
  children: Array<{
    name: string;
    key: string;       // logical key relative to account home
    isDir: boolean;
    size: number;      // 0 for dirs (or direct marker size)
    childCount?: number; // direct children only if cheap; else omit
  }>;
}
```

- Implementation: `list` with delimiter `/` for one level; recursive summary via capped `list` without delimiter or walk with limit.
- Never leak keys outside `homes/<user>/` for role=user targets; for admin target with empty home, still hide `_$flaredrive$/`.

### `PUT /api/accounts/:username/avatar`

- Body: JSON `{ kind: "preset", value: "<id>" }` **or** multipart/raw image with `Content-Type` image/jpeg|png|webp (max e.g. 512KB after client resize).
- Authz: self or admin.
- Clears previous upload object when switching to preset.
- Response: updated public user fields for avatar.

### `DELETE /api/accounts/:username/avatar` (optional)

- Reset to default (no avatar / default preset).

### Existing `/api/users`

- Keep for create / reset-password / disable from Settings.
- List on Settings can be removed in favor of Accounts page link; create stays.

## UI

### List (`AccountsView`)

Table columns: Avatar | Username | Role | Status | Files | Total size | Actions (“查看”).

- Click row or 查看 → `#/accounts/<username>`.
- Empty state for non-admin with no stats edge cases.

### Detail (`AccountDetailView`)

- Header: large avatar, username, chips (role / disabled), “更换头像”.
- Avatar dialog: grid of presets + “上传图片” (client crop to square ~256px, compress) + clear.
- Tree table (MUI Table or DataGrid-like custom):

| (expand) | Name | Type | Size / 子项 | |
| --- | --- | --- | --- | --- |

- Root row always present with summary; expand folder → fetch `tree?path=...`, nest rows with indent.
- Collapse keeps loaded children in memory for session (optional remount clear).
- “在网盘中打开” for folders/files when caller can navigate there (admin → absolute path including `homes/user/...` if viewing another user; self → logical path under own jail).

### Settings

- Replace inline account list cards with short copy + button navigating to `#/accounts`.
- Keep create-account card as today.

### Header

- Show current user avatar (preset or upload) next to account menu when available.

## Performance / platform constraints

- Workers Free ~10ms CPU: PBKDF2 already at 5k; tree listing must be R2-bound (await list), avoid heavy CPU.
- Cap recursive summary scans (document `truncated`).
- Lazy children: one delimiter list per expand.
- Avatar upload size limit enforced server-side.

## Testing

- API: authz matrix (self / other / admin); tree path traversal `..` rejected; internal prefix hidden; stats cap sets `truncated`.
- Avatar: preset write; upload write+overwrite; non-owner 403.
- Frontend: route decode/encode; list renders; expand loads children (mock fetch); Settings link present for admin.

## Open points resolved in this spec

- Admin stats = whole bucket minus internal prefix (not only `homes/`).
- Create user remains on Settings; Accounts page is browse/inspect/avatar.
- Avatar serving via accounts API (not WebDAV path) to avoid home scoping.

## Out of scope follow-ups

- Cached stats in KV / periodic job.
- Admin actions (disable / reset password) duplicated on detail page.
- Drag-drop avatar crop polish.
