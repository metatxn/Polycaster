"use client";

import { Check, Palette } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  getKwColorScheme,
  getKwThemeFromAppTheme,
  KW_THEMES,
  type KwTheme,
} from "@/components/kw-theme-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Theme runtime for Knoww's marketing surfaces (landing + privacy + terms +
 * future editorial pages). Owns the light/dark state and the toggle button.
 * The matching CSS (palette, grain, typography, motion) lives in
 * `globals.css` under the "MARKETING PAGES" section, scoped to `.kw-page`.
 *
 * Usage:
 *   export default function MyPage() {
 *     const { theme, colorScheme, setTheme } = useKwTheme();
 *     return (
 *       <div
 *         className={`${KW_PAGE_CLASS} fixed inset-0 z-60 overflow-y-auto ...`}
 *         data-theme={theme}
 *         style={{ colorScheme }}
 *       >
 *         <KwThemeDropdown theme={theme} onThemeChange={setTheme} />
 *         ...
 *       </div>
 *     );
 *   }
 */

/** CSS scope class that all shared theme vars/classes are nested under. */
export const KW_PAGE_CLASS = "kw-page";

const LEGACY_STORAGE_KEY = "knoww-landing-theme";
const NEXT_THEMES_STORAGE_KEY = "theme";

/**
 * Theme state hook — reads and writes the app-wide `next-themes` value.
 * Keeps a one-time migration path for the old landing-only localStorage key.
 */
export function useKwTheme() {
  const { theme: appTheme, resolvedTheme, setTheme: setAppTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const savedLandingTheme = localStorage.getItem(
        LEGACY_STORAGE_KEY
      ) as KwTheme | null;
      const savedAppTheme = localStorage.getItem(NEXT_THEMES_STORAGE_KEY);

      if (
        !savedAppTheme &&
        (savedLandingTheme === "dark" || savedLandingTheme === "light")
      ) {
        setAppTheme(savedLandingTheme);
      }
    } catch {}
    setMounted(true);
  }, [setAppTheme]);

  const theme = mounted
    ? getKwThemeFromAppTheme(appTheme ?? resolvedTheme)
    : "light";
  const colorScheme = getKwColorScheme(theme);

  const setTheme = (nextTheme: KwTheme) => {
    setAppTheme(nextTheme);
  };

  return { colorScheme, setTheme, theme };
}

/**
 * Theme dropdown — styled to match the editorial aesthetic.
 */
export function KwThemeDropdown({
  theme,
  onThemeChange,
}: {
  theme: KwTheme;
  onThemeChange: (theme: KwTheme) => void;
}) {
  const activeTheme = KW_THEMES.find((item) => item.value === theme);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Select theme"
          className="inline-flex h-9 min-w-[124px] items-center gap-2 border border-(--kw-fg)/15 bg-(--kw-bg) px-3 text-[12px] font-medium text-(--kw-fg) transition-colors hover:border-(--kw-fg)/40 hover:bg-(--kw-fg)/5"
        >
          <Palette className="h-3.5 w-3.5 shrink-0" />
          <span
            className="h-3.5 w-3.5 shrink-0 rounded-full border border-(--kw-fg)/20"
            style={{ backgroundColor: activeTheme?.preview }}
          />
          <span className="min-w-0 truncate">
            {activeTheme?.label ?? "Theme"}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[100] w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Theme
        </DropdownMenuLabel>
        <div className="grid grid-cols-2 gap-1 p-1">
          {KW_THEMES.filter((item) => !item.isDark).map((item) => (
            <KwThemeMenuButton
              key={item.value}
              active={theme === item.value}
              theme={item}
              onThemeChange={onThemeChange}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1 p-1">
          {KW_THEMES.filter((item) => item.isDark).map((item) => (
            <KwThemeMenuButton
              key={item.value}
              active={theme === item.value}
              theme={item}
              onThemeChange={onThemeChange}
            />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KwThemeMenuButton({
  active,
  onThemeChange,
  theme,
}: {
  active: boolean;
  onThemeChange: (theme: KwTheme) => void;
  theme: (typeof KW_THEMES)[number];
}) {
  return (
    <DropdownMenuItem
      onClick={() => onThemeChange(theme.value)}
      onSelect={() => onThemeChange(theme.value)}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-primary/15 text-primary ring-1 ring-primary/30"
          : "hover:bg-muted"
      )}
    >
      <span
        className="h-4 w-4 shrink-0 rounded-full border border-border/50"
        style={{ backgroundColor: theme.preview }}
      />
      <span className="truncate">{theme.label}</span>
      {active && <Check className="ml-auto h-3 w-3 shrink-0 text-primary" />}
    </DropdownMenuItem>
  );
}
