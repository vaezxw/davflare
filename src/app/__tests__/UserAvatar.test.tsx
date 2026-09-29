import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import UserAvatar, {
  avatarCacheKey,
  invalidateAvatarUrlCache,
} from "../../UserAvatar";
import { authFetch } from "../auth";

vi.mock("../auth", () => ({
  authFetch: vi.fn(),
}));

const mockAuthFetch = authFetch as unknown as ReturnType<typeof vi.fn>;

describe("UserAvatar", () => {
  afterEach(() => {
    invalidateAvatarUrlCache();
    vi.clearAllMocks();
  });

  test("avatarCacheKey includes avatar value for busting", () => {
    expect(avatarCacheKey("/api/accounts/a/avatar", { kind: "upload", value: "1" })).toBe(
      "/api/accounts/a/avatar#1"
    );
    expect(avatarCacheKey("/api/accounts/a/avatar", null)).toBe("/api/accounts/a/avatar#");
  });

  test("invalidateAvatarUrlCache clears matching keys", () => {
    invalidateAvatarUrlCache();
    invalidateAvatarUrlCache("/api/accounts/a/avatar");
  });

  test("renders initials for empty avatar and multi-part username", () => {
    const { rerender } = render(
      <UserAvatar username="alice-bob" avatar={null} avatarUrl={null} />
    );
    expect(screen.getByText("AB")).toBeInTheDocument();

    rerender(<UserAvatar username="   " avatar={null} avatarUrl={null} />);
    expect(screen.getByText("?")).toBeInTheDocument();

    rerender(
      <UserAvatar
        username="carol"
        avatar={{ kind: "preset", value: "preset-01" }}
        avatarUrl={null}
      />
    );
    expect(screen.getByText("CA")).toBeInTheDocument();
  });

  test("loads upload avatar via authFetch and shows image", async () => {
    const createObjectURL = vi.fn(() => "blob:avatar");
    const original = URL.createObjectURL;
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;

    mockAuthFetch.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["png"], { type: "image/png" }),
    });

    render(
      <UserAvatar
        username="alice"
        avatar={{ kind: "upload", value: "123" }}
        avatarUrl="/api/accounts/alice/avatar"
        size={48}
      />
    );

    await waitFor(() => {
      const img = screen.getByRole("img", { name: "alice" });
      expect(img.getAttribute("src")).toBe("blob:avatar");
    });
    expect(mockAuthFetch).toHaveBeenCalledWith("/api/accounts/alice/avatar");
    expect(createObjectURL).toHaveBeenCalled();

    URL.createObjectURL = original;
  });

  test("falls back to initials when upload fetch fails", async () => {
    mockAuthFetch.mockResolvedValue({ ok: false });

    render(
      <UserAvatar
        username="dave"
        avatar={{ kind: "upload", value: "9" }}
        avatarUrl="/api/accounts/dave/avatar"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("DA")).toBeInTheDocument();
    });
  });

  test("falls back when authFetch throws", async () => {
    mockAuthFetch.mockRejectedValue(new Error("network"));

    render(
      <UserAvatar
        username="erin"
        avatar={{ kind: "upload", value: "8" }}
        avatarUrl="/api/accounts/erin/avatar"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("ER")).toBeInTheDocument();
    });
  });
});
