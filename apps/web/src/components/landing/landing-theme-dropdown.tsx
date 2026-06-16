"use client";

import { KwThemeDropdown, useKwTheme } from "@/components/kw-theme";

/**
 * Self-contained island so the server-rendered landing header can mount the
 * theme picker without dragging the whole header into client JS. Shares
 * next-themes state with LandingShell, so both hook instances stay in sync.
 */
export function LandingThemeDropdown() {
  const { setTheme, theme } = useKwTheme();
  return <KwThemeDropdown theme={theme} onThemeChange={setTheme} />;
}
