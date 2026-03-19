"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

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

// Accent colors
export type AccentColor =
  | "default"
  | "violet"
  | "blue"
  | "emerald"
  | "rose"
  | "orange"
  | "cyan";

export const ACCENT_COLORS: {
  value: AccentColor;
  label: string;
  color: string;
}[] = [
  { value: "default", label: "Default", color: "#171717" },
  { value: "violet", label: "Violet", color: "#8b5cf6" },
  { value: "blue", label: "Blue", color: "#3b82f6" },
  { value: "emerald", label: "Emerald", color: "#10b981" },
  { value: "rose", label: "Rose", color: "#f43f5e" },
  { value: "orange", label: "Orange", color: "#f97316" },
  { value: "cyan", label: "Cyan", color: "#06b6d4" },
];

interface AccentColorContextType {
  accentColor: AccentColor;
  setAccentColor: (color: AccentColor) => void;
}

const AccentColorContext = createContext<AccentColorContextType | undefined>(
  undefined
);

const ACCENT_COLOR_STORAGE_KEY = "knoww-accent-color";

export function AccentColorProvider({ children }: { children: ReactNode }) {
  const [accentColor, setAccentColorState] = useState<AccentColor>("default");
  const [mounted, setMounted] = useState(false);

  // Load saved accent color on mount
  useEffect(() => {
    const saved = localStorage.getItem(
      ACCENT_COLOR_STORAGE_KEY
    ) as AccentColor | null;
    if (saved && ACCENT_COLORS.some((c) => c.value === saved)) {
      setAccentColorState(saved);
      if (saved !== "default") {
        document.documentElement.setAttribute("data-accent", saved);
      }
    }
    setMounted(true);
  }, []);

  const setAccentColor = useCallback((color: AccentColor) => {
    setAccentColorState(color);
    localStorage.setItem(ACCENT_COLOR_STORAGE_KEY, color);

    if (color === "default") {
      document.documentElement.removeAttribute("data-accent");
    } else {
      document.documentElement.setAttribute("data-accent", color);
    }
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <AccentColorContext.Provider value={{ accentColor, setAccentColor }}>
      {children}
    </AccentColorContext.Provider>
  );
}

export function useAccentColor() {
  const context = useContext(AccentColorContext);
  if (context === undefined) {
    throw new Error(
      "useAccentColor must be used within an AccentColorProvider"
    );
  }
  return context;
}

// Legacy exports for backwards compatibility
export const useColorTheme = useAccentColor;
export const ColorThemeProvider = AccentColorProvider;
export type ColorTheme = AccentColor;
export const COLOR_THEMES = ACCENT_COLORS;
