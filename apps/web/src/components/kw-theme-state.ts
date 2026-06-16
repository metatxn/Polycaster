export type KwTheme =
  | "light"
  | "dark"
  | "midnight"
  | "ocean"
  | "slate"
  | "softpop"
  | "sunset"
  | "forest"
  | "lavender";

export const KW_THEMES: {
  value: KwTheme;
  label: string;
  preview: string;
  isDark: boolean;
}[] = [
  { value: "light", label: "Light", preview: "#f6f4ee", isDark: false },
  { value: "dark", label: "Dark", preview: "#0c0a07", isDark: true },
  { value: "midnight", label: "Midnight", preview: "#15172e", isDark: true },
  { value: "ocean", label: "Ocean", preview: "#071923", isDark: true },
  { value: "slate", label: "Slate", preview: "#111318", isDark: true },
  { value: "softpop", label: "Soft Pop", preview: "#051414", isDark: true },
  { value: "sunset", label: "Sunset", preview: "#fff1df", isDark: false },
  { value: "forest", label: "Forest", preview: "#edf8ef", isDark: false },
  { value: "lavender", label: "Lavender", preview: "#f5f0ff", isDark: false },
];

const KW_THEME_VALUES = new Set(KW_THEMES.map((theme) => theme.value));

export function getKwThemeFromAppTheme(
  appTheme: string | null | undefined
): KwTheme {
  return appTheme && KW_THEME_VALUES.has(appTheme as KwTheme)
    ? (appTheme as KwTheme)
    : "light";
}

export function getKwColorScheme(theme: KwTheme): "light" | "dark" {
  return KW_THEMES.find((item) => item.value === theme)?.isDark
    ? "dark"
    : "light";
}

/** Theme values that map to a dark color-scheme — consumed by the
 *  pre-paint inline script in landing-shell so it can set data-scheme
 *  without importing the full KW_THEMES table into the script string. */
export const KW_DARK_THEME_VALUES: readonly KwTheme[] = KW_THEMES.filter(
  (t) => t.isDark
).map((t) => t.value);
