import { onRequestGet as listAccounts } from "../../../functions/api/accounts";
import {
  createStoredUser,
  putStoredUser,
} from "../../../functions/_users";
import {
  InMemoryBucket,
  basicAuthHeader,
  makeContext,
} from "../testInMemoryBucket";

const HOST = "https://drive.example";

function env(bucket: InMemoryBucket) {
  return {
    BUCKET: bucket.asBucket(),
    WEBDAV_USERNAME: "admin",
    WEBDAV_PASSWORD: "bootstrap-password",
  };
}

function request(path: string, username?: string, password?: string) {
  const headers: Record<string, string> = {};
  if (username !== undefined && password !== undefined) {
    headers.Authorization = basicAuthHeader(username, password);
  }
  return new Request(`${HOST}${path}`, { method: "GET", headers });
}

type AccountProfile = {
  username: string;
  role: "admin" | "user";
  disabled: boolean;
  avatar: { kind: "preset" | "upload"; value: string } | null;
  avatarUrl: string | null;
  stats: { fileCount: number; totalBytes: number; truncated: boolean };
};

describe("GET /api/accounts", () => {
  test("returns 401 without auth", async () => {
    const bucket = new InMemoryBucket();
    const response = await listAccounts(
      makeContext(request("/api/accounts"), env(bucket))
    );
    expect(response.status).toBe(401);
  });

  test("ordinary user sees only self with home stats", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "alice-password", {
        role: "user",
        avatar: { kind: "upload", value: "alice-avatar" },
      })
    );
    bucket.seed([
      { key: "homes/alice/notes.txt", body: "hello" },
      { key: "homes/alice/photo.bin", body: "1234567890" },
      { key: "homes/bob/other.txt", body: "secret" },
      { key: "root.txt", body: "admin-only" },
    ]);

    const response = await listAccounts(
      makeContext(
        request("/api/accounts", "alice", "alice-password"),
        env(bucket)
      )
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { accounts: AccountProfile[] };
    expect(body.accounts).toEqual([
      {
        username: "alice",
        role: "user",
        disabled: false,
        avatar: { kind: "upload", value: "alice-avatar" },
        avatarUrl: "/api/accounts/alice/avatar",
        stats: { fileCount: 2, totalBytes: 15, truncated: false },
      },
    ]);
  });

  test("admin lists bootstrap and stored users with stats", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "alice-password", {
        role: "user",
        avatar: { kind: "preset", value: "preset-01" },
      })
    );
    bucket.seed([
      { key: "homes/alice/a.txt", body: "aa" },
      { key: "shared.txt", body: "bbbb" },
      { key: "_$flaredrive$/avatars/alice", body: "img" },
    ]);

    const response = await listAccounts(
      makeContext(
        request("/api/accounts", "admin", "bootstrap-password"),
        env(bucket)
      )
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { accounts: AccountProfile[] };
    expect(body.accounts).toEqual([
      {
        username: "admin",
        role: "admin",
        disabled: false,
        avatar: null,
        avatarUrl: null,
        // admin home is bucket root; skips internal keys; includes alice home objects
        stats: { fileCount: 2, totalBytes: 6, truncated: false },
      },
      {
        username: "alice",
        role: "user",
        disabled: false,
        avatar: { kind: "preset", value: "preset-01" },
        avatarUrl: null,
        stats: { fileCount: 1, totalBytes: 2, truncated: false },
      },
    ]);
  });
});
