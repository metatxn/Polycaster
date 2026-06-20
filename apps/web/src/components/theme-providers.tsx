"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { ALL_THEMES } from "@/lib/themes";

export function ThemeProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      themes={[...ALL_THEMES]}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
