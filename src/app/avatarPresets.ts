export type AvatarPreset = {
  id: string;
  color: string;
  label: string;
};

/** Client-only colored initials presets (ids match server `isAllowedPresetId`). */
export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "preset-01", color: "#e57373", label: "Coral" },
  { id: "preset-02", color: "#f06292", label: "Rose" },
  { id: "preset-03", color: "#ba68c8", label: "Orchid" },
  { id: "preset-04", color: "#9575cd", label: "Lavender" },
  { id: "preset-05", color: "#7986cb", label: "Indigo" },
  { id: "preset-06", color: "#64b5f6", label: "Sky" },
  { id: "preset-07", color: "#4dd0e1", label: "Cyan" },
  { id: "preset-08", color: "#4db6ac", label: "Teal" },
  { id: "preset-09", color: "#81c784", label: "Moss" },
  { id: "preset-10", color: "#aed581", label: "Lime" },
  { id: "preset-11", color: "#ffb74d", label: "Amber" },
  { id: "preset-12", color: "#ff8a65", label: "Peach" },
];

export function findAvatarPreset(id: string): AvatarPreset | undefined {
  return AVATAR_PRESETS.find((preset) => preset.id === id);
}
