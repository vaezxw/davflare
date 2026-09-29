# Task 7 Report: AccountsView + AccountDetailView

## Status

**DONE** — TDD cycle completed; changes committed on `main`.

## TDD workflow

| Step | Action | Result |
|------|--------|--------|
| 1 | Wrote `AccountsView.test.tsx` + `AccountDetailView.test.tsx` (mocked `accountProfiles` / `useFeatures`) | — |
| 2 | `npx vitest run …AccountsView.test.tsx …AccountDetailView.test.tsx` | FAIL (stubs) |
| 3 | Implemented list + detail UIs; wired `navigate`/`onNotify` in `Main.tsx` | — |
| 4 | Same vitest + `tsc --noEmit` | PASS (10/10) + types OK |
| 5 | Commit `feat: accounts list and detail tree UI` | see SHA below |

## Changes

### `src/AccountsView.tsx`
- MUI Table: Avatar, Username, Role, Status, Files, Total size, Action
- Loads via `listAccountProfiles`; sizes via `formatListingSize`
- Row / 查看 → `navigate({ kind: "account", username })`

### `src/AccountDetailView.tsx`
- Header: `UserAvatar` 72, role/disabled chips, 更换头像
- Avatar dialog: preset grid, upload (`cropAvatarSquare` → 256px webp/jpeg ≤512KB), clear
- Lazy tree: `expanded` Set; root `fetchAccountTree(user,"")`; expand folder fetches path
- Truncated → warning Alert
- Open in drive: self → `child.key` (+`/`); other → `homes/U/...`

### `src/Main.tsx`
- Passes `navigate` + `onNotify` into both views

### Tests
- `AccountsView.test.tsx` (3): list/nav, load error, empty
- `AccountDetailView.test.tsx` (7): header/tree, lazy expand, drive paths self/admin, preset dialog, truncated, load error

## Verification

```bash
npx vitest run src/app/__tests__/AccountsView.test.tsx src/app/__tests__/AccountDetailView.test.tsx  # PASS 10/10
npx tsc --noEmit -p tsconfig.json  # PASS
```

## Commit

- **SHA:** `8f2e9b6`
- **Subject:** feat: accounts list and detail tree UI

---

## Review fix: open-in-drive admin homes

### Finding
Open-in-drive always prefixed `homes/<username>/` for non-self accounts, which is wrong when the viewed account is an **admin** (`homePrefix` is bucket root `""`).

### Fix
- `drivePathForChild` now takes optional `role`; uses logical `child.key` when viewing self **or** `role === "admin"`.
- Otherwise `homes/${username}/${child.key}` (and `homes/${username}/` for root).
- `openInDrive` passes `profile?.role`.
- Tests: admin-viewing-user (prefix) + admin-viewing-admin (logical path).

### Verification (re-run)

```bash
npx vitest run src/app/__tests__/AccountDetailView.test.tsx src/app/__tests__/AccountsView.test.tsx
```

**Result:** PASS — 2 files, **11/11** tests (AccountsView 3 + AccountDetailView 8).

### Commit

- **SHA:** `a5724b9320a4ac8b80f401d8ab32f4dda1de2e48`
- **Subject:** `fix: open-in-drive paths for admin account homes`
