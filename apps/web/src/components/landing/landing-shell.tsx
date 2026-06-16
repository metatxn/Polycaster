"use client";

import type { ReactNode } from "react";
import { CursorGlow } from "@/components/cursor-glow";
import { KW_PAGE_CLASS, useKwTheme } from "@/components/kw-theme";
import { KW_DARK_THEME_VALUES } from "@/components/kw-theme-state";

// Pre-paint theme stamp. Runs while the HTML is streaming, before first
// paint of the content below it: reads the next-themes key and corrects
// the parent div's theme attributes so dark-theme visitors never see the
// server-rendered "light" frame. Must stay dependency-free and tiny.
const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(!t||t==="light")return;var d=${JSON.stringify(KW_DARK_THEME_VALUES)};var p=document.currentScript.parentElement;p.setAttribute("data-theme",t);var s=d.indexOf(t)>=0?"dark":"light";p.setAttribute("data-scheme",s);p.style.colorScheme=s;}catch(e){}})()`;

/**
 * Client shell for the landing page: owns the next-themes-driven theme
 * attributes on the page root and the pointer-tracking glow. Everything
 * passed as children stays server-rendered — keep this file free of any
 * content markup so the sections never get pulled back into client JS.
 */
export function LandingShell({ children }: { children: ReactNode }) {
  const { colorScheme, theme } = useKwTheme();

  return (
    <div
      className={`${KW_PAGE_CLASS} kw-landing fixed inset-0 z-60 overflow-x-hidden overflow-y-auto bg-(--kw-bg) text-(--kw-fg) font-sans`}
      data-theme={theme}
      data-scheme={colorScheme}
      style={{ colorScheme }}
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:bg-(--kw-fg) focus:text-(--kw-bg) focus:px-4 focus:py-2 focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>
      <CursorGlow />
      {children}
    </div>
  );
}
