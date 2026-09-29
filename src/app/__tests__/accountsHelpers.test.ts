import {
  STATS_OBJECT_CAP,
  AVATARS_PREFIX,
  avatarObjectKey,
  isAllowedPresetId,
  resolveTargetHome,
  canManageAccount,
  summarizePrefix,
  listTreeChildren,
} from "../../../functions/_accounts";
import {
  AuthenticatedPrincipal,
  USERS_PREFIX,
  createStoredUser,
  putStoredUser,
} from "../../../functions/_users";
import { InMemoryBucket } from "../testInMemoryBucket";

function principal(
  username: string,
  role: "admin" | "user",
  homePrefix?: string
): AuthenticatedPrincipal {
  return {
    username,
    role,
    homePrefix:
      homePrefix ?? (role === "admin" ? "" : `homes/${username}/`),
  };
}

describe("accounts helpers", () => {
  test("avatarObjectKey and isAllowedPresetId", () => {
    expect(AVATARS_PREFIX).toBe("_$flaredrive$/avatars/");
    expect(avatarObjectKey("alice")).toBe("_$flaredrive$/avatars/alice");
    expect(isAllowedPresetId("preset-01")).toBe(true);
    expect(isAllowedPresetId("preset-12")).toBe(true);
    expect(isAllowedPresetId("preset-00")).toBe(false);
    expect(isAllowedPresetId("preset-13")).toBe(false);
    expect(isAllowedPresetId("preset-1")).toBe(false);
    expect(isAllowedPresetId("preset-01:")).toBe(false);
  });

  test("canManageAccount allows self and admin only", () => {
    expect(canManageAccount(principal("alice", "user"), "alice")).toBe(true);
    expect(canManageAccount(principal("alice", "user"), "bob")).toBe(false);
    expect(canManageAccount(principal("drive", "admin"), "alice")).toBe(true);
    expect(canManageAccount(principal("drive", "admin"), "drive")).toBe(true);
  });

  test("resolveTargetHome maps bootstrap, admin, user, unknown", async () => {
    const bucket = new InMemoryBucket();
    const env = {
      BUCKET: bucket.asBucket(),
      WEBDAV_USERNAME: "drive",
    };
    const adminPrincipal = principal("drive", "admin");

    const bootstrap = await resolveTargetHome("drive", env, adminPrincipal);
    expect(bootstrap).toEqual({ homePrefix: "", role: "admin" });

    const alice = await createStoredUser("alice", "password1", { role: "user" });
    const bobAdmin = await createStoredUser("bob", "password1", {
      role: "admin",
    });
    await putStoredUser(bucket.asBucket(), alice);
    await putStoredUser(bucket.asBucket(), bobAdmin);

    await expect(
      resolveTargetHome("alice", env, adminPrincipal)
    ).resolves.toEqual({ homePrefix: "homes/alice/", role: "user" });
    await expect(
      resolveTargetHome("bob", env, adminPrincipal)
    ).resolves.toEqual({ homePrefix: "", role: "admin" });

    const missing = await resolveTargetHome("ghost", env, adminPrincipal);
    expect(missing).toBeInstanceOf(Response);
    expect((missing as Response).status).toBe(404);

    const bad = await resolveTargetHome("Bad_User", env, adminPrincipal);
    expect(bad).toBeInstanceOf(Response);
    expect((bad as Response).status).toBe(400);
  });

  test("summarizePrefix skips internal and caps", async () => {
    const bucket = new InMemoryBucket();
    bucket.seedDir("homes/alice");
    bucket.seedDir("homes/alice/docs");
    bucket.seed([
      { key: "homes/alice/a.txt", body: "aa" },
      { key: "homes/alice/docs/b.txt", body: "bbbb" },
      { key: "homes/alice/docs/c.txt", body: "c" },
      {
        key: `${USERS_PREFIX}alice.json`,
        body: "{}",
      },
      {
        key: `${AVATARS_PREFIX}alice`,
        body: "img",
        contentType: "image/png",
      },
    ]);

    const summary = await summarizePrefix(
      bucket.asBucket(),
      "homes/alice/"
    );
    expect(summary).toEqual({
      fileCount: 3,
      totalBytes: 2 + 4 + 1,
      truncated: false,
    });

    const many = new InMemoryBucket();
    const entries = [];
    for (let i = 0; i < STATS_OBJECT_CAP + 3; i++) {
      entries.push({
        key: `homes/alice/f-${String(i).padStart(5, "0")}.txt`,
        body: "x",
      });
    }
    many.seed(entries);
    const capped = await summarizePrefix(many.asBucket(), "homes/alice/");
    expect(capped.truncated).toBe(true);
    expect(capped.fileCount).toBe(STATS_OBJECT_CAP);
    expect(capped.totalBytes).toBe(STATS_OBJECT_CAP);
  });

  test("summarizePrefix charges internal keys toward scan cap", async () => {
    const bucket = new InMemoryBucket();
    const entries = [];
    for (let i = 0; i < STATS_OBJECT_CAP + 5; i++) {
      entries.push({
        key: `_$flaredrive$/thumbnails/t-${String(i).padStart(5, "0")}`,
        body: "x",
      });
    }
    // Would be countable if internals were free — must not be reached past cap.
    entries.push({ key: "homes/alice/a.txt", body: "aa" });
    bucket.seed(entries);

    const summary = await summarizePrefix(bucket.asBucket(), "");
    expect(summary.truncated).toBe(true);
    expect(summary.fileCount).toBe(0);
    expect(summary.totalBytes).toBe(0);
  });

  test("listTreeChildren returns one level under home", async () => {
    const bucket = new InMemoryBucket();
    bucket.seedDir("homes/alice");
    bucket.seedDir("homes/alice/docs");
    bucket.seed([
      { key: "homes/alice/readme.txt", body: "hello" },
      { key: "homes/alice/docs/nested.txt", body: "nested" },
      {
        key: "homes/alice/_$flaredrive$/secret.txt",
        body: "nope",
      },
      {
        key: `${AVATARS_PREFIX}alice`,
        body: "img",
        contentType: "image/png",
      },
    ]);

    const root = await listTreeChildren(
      bucket.asBucket(),
      "homes/alice/",
      ""
    );
    expect(root.summary).toEqual({
      fileCount: 2,
      totalBytes: 5 + 6,
      truncated: false,
    });
    expect(root.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "docs",
          key: "docs",
          isDir: true,
          size: 0,
        }),
        expect.objectContaining({
          name: "readme.txt",
          key: "readme.txt",
          isDir: false,
          size: 5,
        }),
      ])
    );
    expect(root.children).toHaveLength(2);
    expect(
      root.children.some((child) => child.key.includes("_$flaredrive$"))
    ).toBe(false);

    const docs = await listTreeChildren(
      bucket.asBucket(),
      "homes/alice/",
      "docs"
    );
    expect(docs.children).toEqual([
      expect.objectContaining({
        name: "nested.txt",
        key: "docs/nested.txt",
        isDir: false,
        size: 6,
      }),
    ]);
    expect(docs.summary).toEqual({
      fileCount: 1,
      totalBytes: 6,
      truncated: false,
    });
  });
});
