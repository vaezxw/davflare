import { useEffect, useState } from "react";
import Avatar from "@mui/material/Avatar";

import { findAvatarPreset } from "./app/avatarPresets";
import { authFetch } from "./app/auth";
import type { UserAvatar as AvatarValue } from "./app/accountProfiles";

const avatarUrlCache = new Map<string, Promise<string | null>>();

function loadAvatarObjectUrl(avatarUrl: string): Promise<string | null> {
  let cached = avatarUrlCache.get(avatarUrl);
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
    avatarUrlCache.set(avatarUrl, cached);
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
  const preset =
    avatar?.kind === "preset" ? findAvatarPreset(avatar.value) : undefined;
  const bg = preset?.color ?? DEFAULT_BG;
  const initials = initialsFor(username);

  useEffect(() => {
    if (!isUpload || !avatarUrl) {
      setSrc(null);
      return;
    }
    let active = true;
    setSrc(null);
    loadAvatarObjectUrl(avatarUrl).then((objectUrl) => {
      if (active) setSrc(objectUrl);
    });
    return () => {
      active = false;
    };
  }, [isUpload, avatarUrl]);

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
