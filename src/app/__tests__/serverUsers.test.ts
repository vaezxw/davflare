import {
  USERS_PREFIX,
  authenticateBasicPrincipal,
  createStoredUser,
  isValidUsername,
  putStoredUser,
  toPublicUser,
  verifyStoredUserPassword,
} from "../../../functions/_users";
import {
  InMemoryBucket,
  basicAuthHeader,
} from "../testInMemoryBucket";
import { isSessionOrKeyAuthorized } from "../../../functions/api/_apikey";

function request(username: string, password: string) {
  return new Request("https://drive.example.com/api/files", {
    headers: { Authorization: basicAuthHeader(username, password) },
  });
}

describe("server user store", () => {
  test("hashes a password and verifies its round trip without storing plaintext", async () => {
    const user = await createStoredUser("alice", "correct horse", {
      role: "user",
    });

    expect(user.password.algorithm).toBe("PBKDF2");
    expect(user.password.hash).toBe("SHA-256");
    expect(user.password.iterations).toBeGreaterThanOrEqual(5_000);
    expect(JSON.stringify(user)).not.toContain("correct horse");
    expect(await verifyStoredUserPassword(user, "correct horse")).toBe(true);
  });

  test("rejects the wrong password", async () => {
    const user = await createStoredUser("alice", "correct horse", {
      role: "user",
    });

    expect(await verifyStoredUserPassword(user, "wrong horse")).toBe(false);
  });

  test("stores user records at the reserved R2 key", async () => {
    const bucket = new InMemoryBucket();
    const user = await createStoredUser("alice", "secret", { role: "user" });

    await putStoredUser(bucket.asBucket(), user);

    expect(bucket.rawJson(`${USERS_PREFIX}alice.json`)).toEqual(user);
  });

  test("rejects a disabled stored user", async () => {
    const bucket = new InMemoryBucket();
    const user = await createStoredUser("alice", "secret", {
      role: "user",
      disabled: true,
    });
    bucket.seed([
      { key: `${USERS_PREFIX}alice.json`, body: JSON.stringify(user) },
    ]);

    await expect(
      authenticateBasicPrincipal(
        request("alice", "secret"),
        bucket.asBucket(),
        "drive",
        "bootstrap-secret"
      )
    ).resolves.toBeNull();
  });

  test("stored bootstrap username is authoritative over environment credentials", async () => {
    const bucket = new InMemoryBucket();
    const user = await createStoredUser("drive", "stored-secret", {
      role: "admin",
    });
    bucket.seed([
      { key: `${USERS_PREFIX}drive.json`, body: JSON.stringify(user) },
    ]);

    await expect(
      authenticateBasicPrincipal(
        request("drive", "bootstrap-secret"),
        bucket.asBucket(),
        "drive",
        "bootstrap-secret"
      )
    ).resolves.toBeNull();
    await expect(
      authenticateBasicPrincipal(
        request("drive", "stored-secret"),
        bucket.asBucket(),
        "drive",
        "bootstrap-secret"
      )
    ).resolves.toEqual({
      username: "drive",
      role: "admin",
      homePrefix: "",
    });
  });

  test("falls back to the exact environment pair as bootstrap admin", async () => {
    const bucket = new InMemoryBucket();

    await expect(
      authenticateBasicPrincipal(
        request("drive", "bootstrap-secret"),
        bucket.asBucket(),
        "drive",
        "bootstrap-secret"
      )
    ).resolves.toEqual({
      username: "drive",
      role: "admin",
      homePrefix: "",
    });
    await expect(
      authenticateBasicPrincipal(
        request("other", "bootstrap-secret"),
        bucket.asBucket(),
        "drive",
        "bootstrap-secret"
      )
    ).resolves.toBeNull();
  });

  test("routes async session authorization through the stored user", async () => {
    const bucket = new InMemoryBucket();
    const user = await createStoredUser("alice", "stored-secret", {
      role: "user",
    });
    await putStoredUser(bucket.asBucket(), user);

    await expect(
      isSessionOrKeyAuthorized(
        request("alice", "stored-secret"),
        bucket.asBucket(),
        "drive",
        "bootstrap-secret"
      )
    ).resolves.toBe(true);
  });

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

  test("rejects invalid usernames", async () => {
    for (const username of ["", "Alice", "alice_b", "alice/b", " alice"]) {
      expect(isValidUsername(username)).toBe(false);
      await expect(createStoredUser(username, "secret", { role: "user" })).rejects.toThrow(
        "Invalid username"
      );
    }
    expect(isValidUsername("drive")).toBe(true);
    expect(isValidUsername("alice-2")).toBe(true);
  });
});
