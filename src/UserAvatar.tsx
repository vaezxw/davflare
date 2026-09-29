import { useEffect, useState } from "react";
import Avatar from "@mui/material/Avatar";

import { findAvatarPreset } from "./app/avatarPresets";
import { authFetch } from "./app/auth";
import type { UserAvatar as AvatarValue } from "./app/accountProfiles";

const avatarUrlCache = new Map<string, Promise<string | null>>();

/** Cache key includes avatar.value so upload overwrite / preset change busts stale blobs. */
export function avatarCacheKey(
  avatarUrl: string,
  avatar: AvatarValue | null | undefined
): string {
  return `${avatarUrl}#${avatar?.value ?? ""}`;
}

export function invalidateAvatarUrlCache(avatarUrl?: string | null): void {
  if (!avatarUrl) {
    avatarUrlCache.clear();
    return;
  }
  for (const key of [...avatarUrlCache.keys()]) {
    if (key === avatarUrl || key.startsWith(`${avatarUrl}#`)) {
      avatarUrlCache.delete(key);
    }
  }
}

function loadAvatarObjectUrl(cacheKey: string, avatarUrl: string): Promise<string | null> {
  let cached = avatarUrlCache.get(cacheKey);
  if (!cached) {
    cached = (async () => {
      try {
        const response = await authFetch(avatarUrl);
        if (!response.ok) return null;
        const blob = await response.blob();
        return URL.createObjectURL(blob);
      } catch {
        return null;
      }
    })();
    avatarUrlCache.set(cacheKey, cached);
  }
  return cached;
}

function initialsFor(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

const DEFAULT_BG = "#90a4ae";

export interface UserAvatarProps {
  username: string;
  avatar: AvatarValue | null;
  avatarUrl: string | null;
  size?: number;
}

export function UserAvatar({
  username,
  avatar,
  avatarUrl,
  size = 40,
}: UserAvatarProps) {
  const [src, setSrc] = useState<string | null>(null);
  const isUpload = avatar?.kind === "upload" && Boolean(avatarUrl);
  const cacheKey =
    isUpload && avatarUrl ? avatarCacheKey(avatarUrl, avatar) : null;
  const preset =
    avatar?.kind === "preset" ? findAvatarPreset(avatar.value) : undefined;
  const bg = preset?.color ?? DEFAULT_BG;
  const initials = initialsFor(username);

  useEffect(() => {
    if (!cacheKey || !avatarUrl) {
      setSrc(null);
      return;
    }
    let active = true;
    setSrc(null);
    loadAvatarObjectUrl(cacheKey, avatarUrl).then((objectUrl) => {
      if (active) setSrc(objectUrl);
    });
    return () => {
      active = false;
    };
  }, [cacheKey, avatarUrl]);

  if (isUpload && src) {
    return (
      <Avatar
        alt={username}
        src={src}
        sx={{ width: size, height: size, fontSize: size * 0.4 }}
      />
    );
  }

  return (
    <Avatar
      alt={username}
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        bgcolor: bg,
        color: "#fff",
      }}
    >
      {initials}
    </Avatar>
  );
}

export default UserAvatar;
