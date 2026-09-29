import {
  onRequestPost as changePassword,
} from "../../../functions/api/account/password";
import {
  onRequestGet as listUsers,
  onRequestPatch as updateUser,
  onRequestPost as createUser,
} from "../../../functions/api/users";
import {
  USERS_PREFIX,
  createStoredUser,
  putStoredUser,
  verifyStoredUserPassword,
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

function request(
  path: string,
  method: string,
  username: string,
  password: string,
  body?: unknown
) {
  return new Request(`${HOST}${path}`, {
    method,
    headers: {
      Authorization: basicAuthHeader(username, password),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/account/password", () => {
  test("changes a stored user's own password", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "old-password", { role: "user" })
    );

    const response = await changePassword(
      makeContext(
        request("/api/account/password", "POST", "alice", "old-password", {
          currentPassword: "old-password",
          newPassword: "new-password",
        }),
        env(bucket)
      )
    );

    expect(response.status).toBe(200);
    const stored = bucket.rawJson<Awaited<ReturnType<typeof createStoredUser>>>(
      `${USERS_PREFIX}alice.json`
    );
    expect(stored).toBeDefined();
    expect(await verifyStoredUserPassword(stored!, "new-password")).toBe(true);
    expect(await verifyStoredUserPassword(stored!, "old-password")).toBe(false);
  });

  test("materializes bootstrap admin as the authoritative stored admin", async () => {
    const bucket = new InMemoryBucket();

    const response = await changePassword(
      makeContext(
        request(
          "/api/account/password",
          "POST",
          "admin",
          "bootstrap-password",
          {
            currentPassword: "bootstrap-password",
            newPassword: "stored-password",
          }
        ),
        env(bucket)
      )
    );

    expect(response.status).toBe(200);
    const stored = bucket.rawJson<Awaited<ReturnType<typeof createStoredUser>>>(
      `${USERS_PREFIX}admin.json`
    );
    expect(stored).toMatchObject({
      username: "admin",
      role: "admin",
      disabled: false,
    });
    expect(await verifyStoredUserPassword(stored!, "stored-password")).toBe(true);
  });

  test("rejects wrong current password and short new passwords", async () => {
    const bucket = new InMemoryBucket();

    const wrong = await changePassword(
      makeContext(
        request("/api/account/password", "POST", "admin", "bootstrap-password", {
          currentPassword: "wrong-password",
          newPassword: "long-enough",
        }),
        env(bucket)
      )
    );
    expect(wrong.status).toBe(400);

    const short = await changePassword(
      makeContext(
        request("/api/account/password", "POST", "admin", "bootstrap-password", {
          currentPassword: "bootstrap-password",
          newPassword: "short",
        }),
        env(bucket)
      )
    );
    expect(short.status).toBe(400);
    expect(bucket.has(`${USERS_PREFIX}admin.json`)).toBe(false);
  });
});

describe("/api/users", () => {
  test("admin lists bootstrap and stored users without password records", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "alice-password", { role: "user" })
    );

    const response = await listUsers(
      makeContext(
        request("/api/users", "GET", "admin", "bootstrap-password"),
        env(bucket)
      )
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      users: Array<Record<string, unknown>>;
    };
    expect(body.users).toEqual([
      { username: "admin", role: "admin", disabled: false },
      { username: "alice", role: "user", disabled: false },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/digest|salt|password/i);
  });

  test("admin creates a normal user and rejects duplicates", async () => {
    const bucket = new InMemoryBucket();
    const create = () =>
      createUser(
        makeContext(
          request("/api/users", "POST", "admin", "bootstrap-password", {
            username: "alice",
            password: "alice-password",
          }),
          env(bucket)
        )
      );

    const response = await create();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      username: "alice",
      role: "user",
      disabled: false,
    });
    expect((await create()).status).toBe(409);
  });

  test("ordinary users cannot administer users", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "alice-password", { role: "user" })
    );

    const response = await listUsers(
      makeContext(
        request("/api/users", "GET", "alice", "alice-password"),
        env(bucket)
      )
    );
    expect(response.status).toBe(403);
  });

  test("admin resets and disables a normal user", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("alice", "alice-password", { role: "user" })
    );

    const reset = await updateUser(
      makeContext(
        request("/api/users", "PATCH", "admin", "bootstrap-password", {
          username: "alice",
          action: "reset-password",
          password: "reset-password",
        }),
        env(bucket)
      )
    );
    expect(reset.status).toBe(200);
    let stored = bucket.rawJson<Awaited<ReturnType<typeof createStoredUser>>>(
      `${USERS_PREFIX}alice.json`
    )!;
    expect(await verifyStoredUserPassword(stored, "reset-password")).toBe(true);

    const disable = await updateUser(
      makeContext(
        request("/api/users", "PATCH", "admin", "bootstrap-password", {
          username: "alice",
          action: "set-disabled",
          disabled: true,
        }),
        env(bucket)
      )
    );
    expect(disable.status).toBe(200);
    stored = bucket.rawJson(`${USERS_PREFIX}alice.json`)!;
    expect(stored.disabled).toBe(true);
  });

  test("does not disable the bootstrap/current administrator", async () => {
    const bucket = new InMemoryBucket();
    await putStoredUser(
      bucket.asBucket(),
      await createStoredUser("admin", "stored-password", { role: "admin" })
    );

    const response = await updateUser(
      makeContext(
        request("/api/users", "PATCH", "admin", "stored-password", {
          username: "admin",
          action: "set-disabled",
          disabled: true,
        }),
        env(bucket)
      )
    );

    expect(response.status).toBe(400);
    expect(
      bucket.rawJson<{ disabled: boolean }>(`${USERS_PREFIX}admin.json`)
        ?.disabled
    ).toBe(false);
  });
});
