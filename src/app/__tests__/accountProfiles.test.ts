import { vi } from "vitest";
import {
  clearAccountAvatar,
  fetchAccountTree,
  listAccountProfiles,
  setAccountAvatarPreset,
  uploadAccountAvatar,
} from "../accountProfiles";
import { AVATAR_PRESETS } from "../avatarPresets";
import { authFetch } from "../auth";
import { setLang } from "../strings";
import { asAuthFetchMock } from "../testUtils";

vi.mock("../auth", () => ({
  authFetch: vi.fn(),
}));

const mockAuthFetch = asAuthFetchMock(authFetch);

beforeEach(() => {
  mockAuthFetch.mockReset();
});

describe("avatarPresets", () => {
  test("exports 12 presets preset-01..preset-12", () => {
    expect(AVATAR_PRESETS).toHaveLength(12);
    expect(AVATAR_PRESETS.map((p) => p.id)).toEqual([
      "preset-01",
      "preset-02",
      "preset-03",
      "preset-04",
      "preset-05",
      "preset-06",
      "preset-07",
      "preset-08",
      "preset-09",
      "preset-10",
      "preset-11",
      "preset-12",
    ]);
    for (const preset of AVATAR_PRESETS) {
      expect(preset.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(preset.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("accountProfiles / listAccountProfiles", () => {
  test("GETs /api/accounts and returns accounts array", async () => {
    const accounts = [
      {
        username: "alice",
        role: "user" as const,
        disabled: false,
        avatar: { kind: "preset" as const, value: "preset-01" },
        avatarUrl: null,
        stats: { fileCount: 1, totalBytes: 2, truncated: false },
      },
    ];
    mockAuthFetch.mockOk({ accounts });
    await expect(listAccountProfiles()).resolves.toEqual(accounts);
    expect(mockAuthFetch).toHaveBeenCalledWith("/api/accounts");
  });

  test("non-2xx throws response text or default", async () => {
    mockAuthFetch.mockError(500, "boom");
    await expect(listAccountProfiles()).rejects.toThrow("boom");

    mockAuthFetch.mockError(500, "");
    setLang("zh");
    await expect(listAccountProfiles()).rejects.toThrow("读取账号失败");
  });
});

describe("accountProfiles / fetchAccountTree", () => {
  test("GETs tree with encoded username and path query", async () => {
    const tree = {
      path: "docs",
      summary: { fileCount: 0, totalBytes: 0, truncated: false },
      children: [],
    };
    mockAuthFetch.mockOk(tree);
    await expect(fetchAccountTree("alice", "docs")).resolves.toEqual(tree);
    expect(mockAuthFetch).toHaveBeenCalledWith(
      "/api/accounts/alice/tree?path=docs"
    );
  });

  test("empty path still sends path=", async () => {
    mockAuthFetch.mockOk({
      path: "",
      summary: { fileCount: 0, totalBytes: 0, truncated: false },
      children: [],
    });
    await fetchAccountTree("bob", "");
    expect(mockAuthFetch).toHaveBeenCalledWith("/api/accounts/bob/tree?path=");
  });

  test("non-2xx throws", async () => {
    mockAuthFetch.mockError(403, "Forbidden");
    await expect(fetchAccountTree("alice", "")).rejects.toThrow("Forbidden");
  });
});

describe("accountProfiles / setAccountAvatarPreset", () => {
  test("PUTs JSON preset body", async () => {
    mockAuthFetch.mockOk({ avatar: { kind: "preset", value: "preset-03" } });
    await setAccountAvatarPreset("alice", "preset-03");
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe("/api/accounts/alice/avatar");
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      kind: "preset",
      value: "preset-03",
    });
  });

  test("non-2xx throws", async () => {
    mockAuthFetch.mockError(400, "Bad Request");
    await expect(setAccountAvatarPreset("alice", "preset-99")).rejects.toThrow(
      "Bad Request"
    );
  });
});

describe("accountProfiles / uploadAccountAvatar", () => {
  test("PUTs blob with image content type", async () => {
    mockAuthFetch.mockOk({ avatar: { kind: "upload", value: "alice" } });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    await uploadAccountAvatar("alice", blob);
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe("/api/accounts/alice/avatar");
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("image/png");
    expect(init.body).toBe(blob);
  });

  test("non-2xx throws", async () => {
    mockAuthFetch.mockError(413, "Payload Too Large");
    await expect(
      uploadAccountAvatar("alice", new Blob(["x"], { type: "image/jpeg" }))
    ).rejects.toThrow("Payload Too Large");
  });
});

describe("accountProfiles / clearAccountAvatar", () => {
  test("DELETEs avatar endpoint", async () => {
    mockAuthFetch.mockOk({ avatar: null });
    await clearAccountAvatar("alice");
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe("/api/accounts/alice/avatar");
    expect(init.method).toBe("DELETE");
  });

  test("non-2xx throws", async () => {
    mockAuthFetch.mockError(403, "Forbidden");
    await expect(clearAccountAvatar("alice")).rejects.toThrow("Forbidden");
  });
});
