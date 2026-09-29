import { onRequestGet as listAccounts } from "../../../functions/api/accounts";
import {
  onRequestGet as getTree,
} from "../../../functions/api/accounts/[username]/tree";
import {
  onRequestDelete as deleteAvatar,
  onRequestGet as getAvatar,
  onRequestPut as putAvatar,
} from "../../../functions/api/accounts/[username]/avatar";
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

function authHeaders(username: string, password: string) {
  return { Authorization: basicAuthHeader(username, password) };
}

describe("GET /api/accounts/:username/tree", () => {
  test("user cannot read other tree", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "alice-password", { role: "user" })
    );
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("bob", "bob-password", { role: "user" })
    );

    const response = await getTree(
      makeContext(
        new Request(`${HOST}/api/accounts/bob/tree`, {
          method: "GET",
          headers: authHeaders("alice", "alice-password"),
        }),
        env(bucket),
        { username: "bob" }
      )
    );

    expect(response.status).toBe(403);
  });

  test("self tree lists homes children as logical paths", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "alice-password", { role: "user" })
    );
    bucket.seedDir("homes/alice");
    bucket.seedDir("homes/alice/docs");
    bucket.seed([
      { key: "homes/alice/readme.txt", body: "hello" },
      { key: "homes/alice/docs/nested.txt", body: "nested" },
      { key: "homes/bob/secret.txt", body: "nope" },
    ]);

    const response = await getTree(
      makeContext(
        new Request(`${HOST}/api/accounts/alice/tree`, {
          method: "GET",
          headers: authHeaders("alice", "alice-password"),
        }),
        env(bucket),
        { username: "alice" }
      )
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      path: string;
      summary: { fileCount: number; totalBytes: number; truncated: boolean };
      children: Array<{ name: string; key: string; isDir: boolean; size: number }>;
    };
    expect(body.path).toBe("");
    expect(body.summary).toEqual({
      fileCount: 2,
      totalBytes: 5 + 6,
      truncated: false,
    });
    expect(body.children).toEqual(
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
    expect(body.children).toHaveLength(2);
  });

  test("path with .. is 400", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "alice-password", { role: "user" })
    );

    const response = await getTree(
      makeContext(
        new Request(`${HOST}/api/accounts/alice/tree?path=../bob`, {
          method: "GET",
          headers: authHeaders("alice", "alice-password"),
        }),
        env(bucket),
        { username: "alice" }
      )
    );

    expect(response.status).toBe(400);
  });
});

describe("avatar APIs", () => {
  test("PUT preset then GET profile reflects it", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "alice-password", { role: "user" })
    );

    const putResponse = await putAvatar(
      makeContext(
        new Request(`${HOST}/api/accounts/alice/avatar`, {
          method: "PUT",
          headers: {
            ...authHeaders("alice", "alice-password"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ kind: "preset", value: "preset-03" }),
        }),
        env(bucket),
        { username: "alice" }
      )
    );
    expect(putResponse.status).toBe(200);

    const listResponse = await listAccounts(
      makeContext(
        new Request(`${HOST}/api/accounts`, {
          method: "GET",
          headers: authHeaders("alice", "alice-password"),
        }),
        env(bucket)
      )
    );
    expect(listResponse.status).toBe(200);
    const body = (await listResponse.json()) as {
      accounts: Array<{
        username: string;
        avatar: { kind: string; value: string } | null;
        avatarUrl: string | null;
      }>;
    };
    expect(body.accounts).toEqual([
      expect.objectContaining({
        username: "alice",
        avatar: { kind: "preset", value: "preset-03" },
        avatarUrl: null,
      }),
    ]);
  });

  test("PUT image stores object and GET returns bytes", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "alice-password", { role: "user" })
    );
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

    const putResponse = await putAvatar(
      makeContext(
        new Request(`${HOST}/api/accounts/alice/avatar`, {
          method: "PUT",
          headers: {
            ...authHeaders("alice", "alice-password"),
            "Content-Type": "image/png",
          },
          body: imageBytes,
        }),
        env(bucket),
        { username: "alice" }
      )
    );
    expect(putResponse.status).toBe(200);

    const getResponse = await getAvatar(
      makeContext(
        new Request(`${HOST}/api/accounts/alice/avatar`, {
          method: "GET",
          headers: authHeaders("alice", "alice-password"),
        }),
        env(bucket),
        { username: "alice" }
      )
    );
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("Content-Type")).toBe("image/png");
    const got = new Uint8Array(await getResponse.arrayBuffer());
    expect([...got]).toEqual([...imageBytes]);
  });

  test("invalid preset id is 400", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "alice-password", { role: "user" })
    );

    const response = await putAvatar(
      makeContext(
        new Request(`${HOST}/api/accounts/alice/avatar`, {
          method: "PUT",
          headers: {
            ...authHeaders("alice", "alice-password"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ kind: "preset", value: "preset-99" }),
        }),
        env(bucket),
        { username: "alice" }
      )
    );

    expect(response.status).toBe(400);
  });

  test("DELETE clears avatar and removes object", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "alice-password", {
        role: "user",
        avatar: { kind: "upload", value: "alice" },
      })
    );
    bucket.seed([
      {
        key: "_$flaredrive$/avatars/alice",
        body: "img",
        contentType: "image/png",
      },
    ]);

    const deleteResponse = await deleteAvatar(
      makeContext(
        new Request(`${HOST}/api/accounts/alice/avatar`, {
          method: "DELETE",
          headers: authHeaders("alice", "alice-password"),
        }),
        env(bucket),
        { username: "alice" }
      )
    );
    expect(deleteResponse.status).toBe(200);

    const getResponse = await getAvatar(
      makeContext(
        new Request(`${HOST}/api/accounts/alice/avatar`, {
          method: "GET",
          headers: authHeaders("alice", "alice-password"),
        }),
        env(bucket),
        { username: "alice" }
      )
    );
    expect(getResponse.status).toBe(404);

    const listResponse = await listAccounts(
      makeContext(
        new Request(`${HOST}/api/accounts`, {
          method: "GET",
          headers: authHeaders("alice", "alice-password"),
        }),
        env(bucket)
      )
    );
    const body = (await listResponse.json()) as {
      accounts: Array<{ avatar: unknown }>;
    };
    expect(body.accounts[0].avatar).toBeNull();
  });
});
