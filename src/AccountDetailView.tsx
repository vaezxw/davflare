import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

import {
  AccountProfile,
  TreeChild,
  TreeResponse,
  clearAccountAvatar,
  fetchAccountTree,
  listAccountProfiles,
  setAccountAvatarPreset,
  uploadAccountAvatar,
} from "./app/accountProfiles";
import { AVATAR_PRESETS } from "./app/avatarPresets";
import { useFeatures } from "./app/features";
import { NotifyFn } from "./app/notify";
import { Route } from "./app/route";
import { strings } from "./app/strings";
import { errorMessage, formatListingSize } from "./app/utils";
import UserAvatar from "./UserAvatar";

const AVATAR_CROP_SIZE = 256;
const AVATAR_MAX_BYTES = 512 * 1024;

/** Center-crop image to square ~256px; prefer webp then jpeg under 512KB. */
export async function cropAvatarSquare(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = objectUrl;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - side) / 2;
    const sy = (image.naturalHeight - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_CROP_SIZE;
    canvas.height = AVATAR_CROP_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(
      image,
      sx,
      sy,
      side,
      side,
      0,
      0,
      AVATAR_CROP_SIZE,
      AVATAR_CROP_SIZE
    );

    const encode = (type: string, quality: number) =>
      new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), type, quality);
      });

    for (const type of ["image/webp", "image/jpeg"] as const) {
      for (const quality of [0.92, 0.8, 0.65, 0.5]) {
        const blob = await encode(type, quality);
        if (blob && blob.size <= AVATAR_MAX_BYTES) return blob;
      }
    }
    const fallback = await encode("image/jpeg", 0.4);
    if (!fallback) throw new Error("Avatar encode failed");
    return fallback;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Map tree child key to drive folder path for navigate. */
export function drivePathForChild(
  viewingUsername: string,
  selfUsername: string,
  child: Pick<TreeChild, "key" | "isDir">
): string {
  const isSelf = viewingUsername === selfUsername;
  if (!child.key) {
    return isSelf ? "" : `homes/${viewingUsername}/`;
  }
  let path = isSelf ? child.key : `homes/${viewingUsername}/${child.key}`;
  if (child.isDir && !path.endsWith("/")) path += "/";
  return path;
}

type TreeNodeState = {
  loaded: boolean;
  loading: boolean;
  children: TreeChild[];
  summary?: TreeResponse["summary"];
};

function AccountDetailView({
  username,
  navigate,
  onNotify,
}: {
  username: string;
  navigate: (route: Route) => void;
  onNotify: NotifyFn;
}) {
  const { config } = useFeatures();
  const selfUsername = config.username;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [nodes, setNodes] = useState<Record<string, TreeNodeState>>({});
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const loadProfile = useCallback(async () => {
    const accounts = await listAccountProfiles();
    const found = accounts.find((item) => item.username === username) ?? null;
    setProfile(found);
    return found;
  }, [username]);

  const loadTreePath = useCallback(
    async (path: string) => {
      setNodes((prev) => ({
        ...prev,
        [path]: {
          loaded: prev[path]?.loaded ?? false,
          loading: true,
          children: prev[path]?.children ?? [],
          summary: prev[path]?.summary,
        },
      }));
      try {
        const tree = await fetchAccountTree(username, path);
        setNodes((prev) => ({
          ...prev,
          [path]: {
            loaded: true,
            loading: false,
            children: tree.children,
            summary: tree.summary,
          },
        }));
        return tree;
      } catch (error) {
        setNodes((prev) => ({
          ...prev,
          [path]: {
            loaded: false,
            loading: false,
            children: prev[path]?.children ?? [],
            summary: prev[path]?.summary,
          },
        }));
        throw error;
      }
    },
    [username]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setExpanded(new Set([""]));
      setNodes({});
      try {
        await loadProfile();
        if (!active) return;
        await loadTreePath("");
      } catch (error) {
        if (active) onNotify(errorMessage(error), "error");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [username, loadProfile, loadTreePath, onNotify]);

  const rootSummary = nodes[""]?.summary;
  const truncated = Boolean(rootSummary?.truncated);

  const flatRows = useMemo(() => {
    type Row = {
      child: TreeChild;
      depth: number;
      pathKey: string;
    };
    const rows: Row[] = [];
    const walk = (pathKey: string, depth: number) => {
      const node = nodes[pathKey];
      if (!node) return;
      for (const child of node.children) {
        rows.push({ child, depth, pathKey: child.key });
        if (child.isDir && expanded.has(child.key)) {
          walk(child.key, depth + 1);
        }
      }
    };
    walk("", 0);
    return rows;
  }, [nodes, expanded]);

  const toggleFolder = async (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!nodes[key]?.loaded) {
      try {
        await loadTreePath(key);
      } catch (error) {
        onNotify(errorMessage(error), "error");
      }
    }
  };

  const openInDrive = (child: TreeChild) => {
    navigate({
      kind: "folder",
      path: drivePathForChild(username, selfUsername, child),
    });
  };

  const refreshAfterAvatar = async () => {
    await loadProfile();
    setAvatarOpen(false);
  };

  const applyPreset = async (presetId: string) => {
    setAvatarBusy(true);
    try {
      await setAccountAvatarPreset(username, presetId);
      await refreshAfterAvatar();
      onNotify(strings.accountUpdated, "success");
    } catch (error) {
      onNotify(errorMessage(error), "error");
    } finally {
      setAvatarBusy(false);
    }
  };

  const clearAvatar = async () => {
    setAvatarBusy(true);
    try {
      await clearAccountAvatar(username);
      await refreshAfterAvatar();
      onNotify(strings.accountUpdated, "success");
    } catch (error) {
      onNotify(errorMessage(error), "error");
    } finally {
      setAvatarBusy(false);
    }
  };

  const onFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    try {
      const blob = await cropAvatarSquare(file);
      await uploadAccountAvatar(username, blob);
      await refreshAfterAvatar();
      onNotify(strings.accountUpdated, "success");
    } catch (error) {
      onNotify(errorMessage(error), "error");
    } finally {
      setAvatarBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const displayProfile: AccountProfile = profile ?? {
    username,
    role: "user",
    disabled: false,
    avatar: null,
    avatarUrl: null,
    stats: rootSummary ?? { fileCount: 0, totalBytes: 0, truncated: false },
  };

  return (
    <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 2, maxWidth: 1100, mx: "auto" }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ sm: "center" }}
        sx={{ mb: 2 }}
      >
        <UserAvatar
          username={displayProfile.username}
          avatar={displayProfile.avatar}
          avatarUrl={displayProfile.avatarUrl}
          size={72}
        />
        <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, wordBreak: "break-all" }}>
            {displayProfile.username}
          </Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label={
                displayProfile.role === "admin"
                  ? strings.accountRoleAdmin
                  : strings.accountRoleUser
              }
              color={displayProfile.role === "admin" ? "primary" : "default"}
              variant={displayProfile.role === "admin" ? "filled" : "outlined"}
            />
            {displayProfile.disabled && (
              <Chip size="small" label={strings.accountDisabled} color="warning" />
            )}
            {rootSummary && (
              <Chip
                size="small"
                variant="outlined"
                label={`${strings.accountFiles}: ${rootSummary.fileCount} · ${formatListingSize(rootSummary.totalBytes)}`}
              />
            )}
          </Stack>
        </Stack>
        <Button variant="outlined" onClick={() => setAvatarOpen(true)}>
          {strings.changeAvatar}
        </Button>
      </Stack>

      {truncated && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {strings.statsTruncated}
        </Alert>
      )}

      {loading && !nodes[""]?.loaded ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40 }} />
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>
                <IconButton
                  size="small"
                  aria-label="root"
                  onClick={() => void toggleFolder("")}
                >
                  {expanded.has("") ? "▼" : "▶"}
                </IconButton>
              </TableCell>
              <TableCell>
                <Typography sx={{ fontWeight: 600 }}>/</Typography>
              </TableCell>
              <TableCell>{strings.folderLabel}</TableCell>
              <TableCell align="right">
                {rootSummary
                  ? `${rootSummary.fileCount} · ${formatListingSize(rootSummary.totalBytes)}`
                  : "—"}
              </TableCell>
              <TableCell align="right">
                <Button
                  size="small"
                  onClick={() =>
                    openInDrive({ name: "", key: "", isDir: true, size: 0 })
                  }
                >
                  {strings.openInDrive}
                </Button>
              </TableCell>
            </TableRow>
            {expanded.has("") &&
              flatRows.map(({ child, depth }) => {
                const isExpanded = expanded.has(child.key);
                const childNode = nodes[child.key];
                return (
                  <TableRow key={child.key} hover>
                    <TableCell>
                      {child.isDir ? (
                        <IconButton
                          size="small"
                          aria-label={child.name}
                          onClick={() => void toggleFolder(child.key)}
                          disabled={childNode?.loading}
                        >
                          {isExpanded ? "▼" : "▶"}
                        </IconButton>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ pl: depth * 2 }}>{child.name}</Typography>
                    </TableCell>
                    <TableCell>
                      {child.isDir ? strings.folderLabel : strings.kindOther}
                    </TableCell>
                    <TableCell align="right">
                      {child.isDir
                        ? childNode?.summary
                          ? `${childNode.summary.fileCount} · ${formatListingSize(childNode.summary.totalBytes)}`
                          : "—"
                        : formatListingSize(child.size)}
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        onClick={() => openInDrive(child)}
                      >
                        {strings.openInDrive}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      )}

      <Dialog open={avatarOpen} onClose={() => !avatarBusy && setAvatarOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{strings.changeAvatar}</DialogTitle>
        <DialogContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {strings.avatarPresets}
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
              gap: 1,
              mb: 2,
            }}
          >
            {AVATAR_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                variant="outlined"
                disabled={avatarBusy}
                onClick={() => void applyPreset(preset.id)}
                sx={{
                  minWidth: 0,
                  flexDirection: "column",
                  py: 1,
                  gap: 0.5,
                }}
              >
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    bgcolor: preset.color,
                  }}
                />
                <Typography variant="caption">{preset.label}</Typography>
              </Button>
            ))}
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="contained"
              disabled={avatarBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              {strings.avatarUpload}
            </Button>
            <Button
              variant="outlined"
              color="warning"
              disabled={avatarBusy}
              onClick={() => void clearAvatar()}
            >
              {strings.avatarClear}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) =>
                void onFileSelected(event.target.files?.[0])
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={avatarBusy} onClick={() => setAvatarOpen(false)}>
            {strings.cancelResetPassword}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default AccountDetailView;
