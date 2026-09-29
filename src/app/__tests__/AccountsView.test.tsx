import { vi, type Mock } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import AccountsView from "../../AccountsView";
import { listAccountProfiles } from "../accountProfiles";
import { setLang, strings } from "../strings";
import { formatListingSize } from "../utils";

vi.mock("../accountProfiles", () => ({
  listAccountProfiles: vi.fn(),
}));

const mockList = listAccountProfiles as unknown as Mock;

const alice = {
  username: "alice",
  role: "user" as const,
  disabled: false,
  avatar: { kind: "preset" as const, value: "preset-01" },
  avatarUrl: null,
  stats: { fileCount: 3, totalBytes: 2048, truncated: false },
};

const bob = {
  username: "bob",
  role: "admin" as const,
  disabled: true,
  avatar: null,
  avatarUrl: null,
  stats: { fileCount: 10, totalBytes: 1024 * 1024, truncated: true },
};

beforeEach(() => {
  setLang("zh");
  mockList.mockReset();
});

describe("AccountsView", () => {
  test("lists accounts in table and navigates on 查看", async () => {
    mockList.mockResolvedValue([alice, bob]);
    const navigate = vi.fn();
    render(<AccountsView navigate={navigate} onNotify={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText(strings.accountRoleUser)).toBeInTheDocument();
    expect(screen.getByText(strings.accountRoleAdmin)).toBeInTheDocument();
    expect(screen.getByText(strings.accountDisabled)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(formatListingSize(2048))).toBeInTheDocument();

    const viewButtons = screen.getAllByRole("button", { name: strings.viewAccount });
    fireEvent.click(viewButtons[0]);
    expect(navigate).toHaveBeenCalledWith({ kind: "account", username: "alice" });
  });

  test("load error notifies", async () => {
    mockList.mockRejectedValue(new Error("list-fail"));
    const onNotify = vi.fn();
    render(<AccountsView navigate={vi.fn()} onNotify={onNotify} />);
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("list-fail", "error"));
  });

  test("empty list shows title without rows", async () => {
    mockList.mockResolvedValue([]);
    render(<AccountsView navigate={vi.fn()} onNotify={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(strings.accountsTitle)).toBeInTheDocument());
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
  });
});
