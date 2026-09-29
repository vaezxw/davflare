import { vi, type Mock } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import AccountDetailView from "../../AccountDetailView";
import {
  clearAccountAvatar,
  fetchAccountTree,
  listAccountProfiles,
  setAccountAvatarPreset,
  uploadAccountAvatar,
} from "../accountProfiles";
import { DEFAULT_FEATURE_FLAGS, useFeatures } from "../features";
import { setLang, strings } from "../strings";

vi.mock("../accountProfiles", () => ({
  listAccountProfiles: vi.fn(),
  fetchAccountTree: vi.fn(),
  setAccountAvatarPreset: vi.fn(),
  uploadAccountAvatar: vi.fn(),
  clearAccountAvatar: vi.fn(),
}));

vi.mock("../features", async () => {
  const actual = await vi.importActual("../features");
  return { ...actual, useFeatures: vi.fn() };
});

const mockList = listAccountProfiles as unknown as Mock;
const mockTree = fetchAccountTree as unknown as Mock;
const mockPreset = setAccountAvatarPreset as unknown as Mock;
const mockUpload = uploadAccountAvatar as unknown as Mock;
const mockClear = clearAccountAvatar as unknown as Mock;
const mockUseFeatures = useFeatures as unknown as Mock;

const profile = {
  username: "alice",
  role: "user" as const,
  disabled: false,
  avatar: { kind: "preset" as const, value: "preset-01" },
  avatarUrl: null,
  stats: { fileCount: 2, totalBytes: 100, truncated: false },
};

const rootTree = {
  path: "",
  summary: { fileCount: 2, totalBytes: 100, truncated: false },
  children: [
    { name: "docs", key: "docs", isDir: true, size: 0 },
    { name: "a.txt", key: "a.txt", isDir: false, size: 50 },
  ],
};

const docsTree = {
  path: "docs",
  summary: { fileCount: 1, totalBytes: 50, truncated: false },
  children: [{ name: "note.md", key: "docs/note.md", isDir: false, size: 50 }],
};

function stubFeatures(username: string, admin = false) {
  mockUseFeatures.mockReturnValue({
    config: {
      username,
      admin,
      publicRead: false,
      sitesHost: null,
      flags: DEFAULT_FEATURE_FLAGS,
    },
    flags: DEFAULT_FEATURE_FLAGS,
    sitesHost: null,
    refresh: vi.fn(),
    updateFlags: vi.fn(),
  });
}

beforeEach(() => {
  setLang("zh");
  mockList.mockReset();
  mockTree.mockReset();
  mockPreset.mockReset();
  mockUpload.mockReset();
  mockClear.mockReset();
  mockList.mockResolvedValue([profile]);
  mockTree.mockImplementation(async (_user: string, path: string) =>
    path === "docs" ? docsTree : rootTree
  );
  mockPreset.mockResolvedValue(undefined);
  mockUpload.mockResolvedValue(undefined);
  mockClear.mockResolvedValue(undefined);
  stubFeatures("alice");
});

describe("AccountDetailView", () => {
  test("shows header, root summary, and children", async () => {
    render(
      <AccountDetailView username="alice" navigate={vi.fn()} onNotify={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
    expect(screen.getByText(strings.accountRoleUser)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.changeAvatar })).toBeInTheDocument();
    expect(await screen.findByText("docs")).toBeInTheDocument();
    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(mockTree).toHaveBeenCalledWith("alice", "");
  });

  test("expanding folder lazy-loads children", async () => {
    render(
      <AccountDetailView username="alice" navigate={vi.fn()} onNotify={vi.fn()} />
    );
    await screen.findByText("docs");
    fireEvent.click(screen.getByRole("button", { name: /docs/i }));
    await waitFor(() => expect(mockTree).toHaveBeenCalledWith("alice", "docs"));
    expect(await screen.findByText("note.md")).toBeInTheDocument();
  });

  test("open in drive uses logical path for self", async () => {
    const navigate = vi.fn();
    stubFeatures("alice");
    render(
      <AccountDetailView username="alice" navigate={navigate} onNotify={vi.fn()} />
    );
    await screen.findByText("docs");
    const row = screen.getByText("docs").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: strings.openInDrive }));
    expect(navigate).toHaveBeenCalledWith({ kind: "folder", path: "docs/" });
  });

  test("open in drive prefixes homes/U for admin viewing other", async () => {
    const navigate = vi.fn();
    stubFeatures("drive", true);
    render(
      <AccountDetailView username="alice" navigate={navigate} onNotify={vi.fn()} />
    );
    await screen.findByText("docs");
    const row = screen.getByText("docs").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: strings.openInDrive }));
    expect(navigate).toHaveBeenCalledWith({
      kind: "folder",
      path: "homes/alice/docs/",
    });
  });

  test("avatar dialog applies preset", async () => {
    const onNotify = vi.fn();
    render(
      <AccountDetailView username="alice" navigate={vi.fn()} onNotify={onNotify} />
    );
    await screen.findByText("alice");
    fireEvent.click(screen.getByRole("button", { name: strings.changeAvatar }));
    expect(await screen.findByText(strings.avatarPresets)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Coral" }));
    await waitFor(() =>
      expect(mockPreset).toHaveBeenCalledWith("alice", "preset-01")
    );
  });

  test("truncated summary shows alert", async () => {
    mockTree.mockResolvedValue({
      ...rootTree,
      summary: { fileCount: 99, totalBytes: 1, truncated: true },
    });
    render(
      <AccountDetailView username="alice" navigate={vi.fn()} onNotify={vi.fn()} />
    );
    expect(await screen.findByText(strings.statsTruncated)).toBeInTheDocument();
  });

  test("load error notifies", async () => {
    mockList.mockRejectedValue(new Error("detail-fail"));
    const onNotify = vi.fn();
    render(
      <AccountDetailView username="alice" navigate={vi.fn()} onNotify={onNotify} />
    );
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("detail-fail", "error"));
  });
});
