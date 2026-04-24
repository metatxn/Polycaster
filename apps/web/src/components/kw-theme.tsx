"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Theme runtime for Knoww's marketing surfaces (landing + privacy + terms +
 * future editorial pages). Owns the light/dark state and the toggle button.
 * The matching CSS (palette, grain, typography, motion) lives in
 * `globals.css` under the "MARKETING PAGES" section, scoped to `.kw-page`.
 *
 * Usage:
 *   export default function MyPage() {
 *     const { theme, toggleTheme } = useKwTheme();
 *     return (
 *       <div
 *         className={`${KW_PAGE_CLASS} fixed inset-0 z-60 overflow-y-auto ...`}
 *         data-theme={theme}
 *         style={{ colorScheme: theme }}
 *       >
 *         <KwThemeToggle theme={theme} onToggle={toggleTheme} />
 *         ...
 *       </div>
 *     );
 *   }
 */

export type KwTheme = "light" | "dark";

/** CSS scope class that all shared theme vars/classes are nested under. */
export const KW_PAGE_CLASS = "kw-page";

const STORAGE_KEY = "knoww-landing-theme";

/**
 * Theme state hook — reads prior preference from localStorage (shared
 * across all Knoww marketing surfaces), falls back to OS preference, and
 * persists updates.
 */
export function useKwTheme() {
  const [theme, setTheme] = useState<KwTheme>("light");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as KwTheme | null;
      if (saved === "dark" || saved === "light") {
        setTheme(saved);
        return;
      }
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        setTheme("dark");
      }
    } catch {}
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next: KwTheme = prev === "light" ? "dark" : "light";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      return next;
    });
  };

  return { theme, toggleTheme };
}

/**
 * Moon/Sun toggle button — styled to match the editorial aesthetic.
 */
export function KwThemeToggle({
  theme,
  onToggle,
}: {
  theme: KwTheme;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={
        theme === "light" ? "Switch to dark theme" : "Switch to light theme"
      }
      onClick={onToggle}
      className="w-9 h-9 flex items-center justify-center border border-(--kw-fg)/15 hover:border-(--kw-fg)/40 hover:bg-(--kw-fg)/5 transition-colors"
    >
      {theme === "light" ? (
        <Moon className="w-3.5 h-3.5" />
      ) : (
        <Sun className="w-3.5 h-3.5" />
      )}
    </button>
  );
}
