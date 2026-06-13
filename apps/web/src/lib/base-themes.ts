// Base themes info (managed by next-themes, this is just metadata)
export type BaseTheme =
  | "light"
  | "dark"
  | "midnight"
  | "sunset"
  | "forest"
  | "ocean"
  | "lavender"
  | "slate"
  | "softpop";

export const BASE_THEMES: {
  value: BaseTheme;
  label: string;
  preview: string;
  isDark: boolean;
}[] = [
  { value: "light", label: "Light", preview: "#ffffff", isDark: false },
  { value: "dark", label: "Dark", preview: "#171717", isDark: true },
  { value: "midnight", label: "Midnight", preview: "#1a1a2e", isDark: true },
  { value: "ocean", label: "Ocean", preview: "#0d1b2a", isDark: true },
  { value: "slate", label: "Slate", preview: "#1e293b", isDark: true },
  { value: "softpop", label: "Soft Pop", preview: "#051414", isDark: true },
  { value: "sunset", label: "Sunset", preview: "#fef3e2", isDark: false },
  { value: "forest", label: "Forest", preview: "#ecfdf5", isDark: false },
  { value: "lavender", label: "Lavender", preview: "#f5f3ff", isDark: false },
];
