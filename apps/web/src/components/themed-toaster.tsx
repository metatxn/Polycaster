"use client";

import { Toaster } from "sonner";
import { useKwTheme } from "@/components/kw-theme";

/**
 * Sonner toaster wired to the active app theme. Previously the layout
 * hardcoded `theme="dark"`, so toasts rendered dark even on the light/
 * sunset/forest/lavender themes. `useKwTheme()` resolves any of the nine
 * themes to a light|dark color scheme so toasts always match the surface.
 */
export function ThemedToaster() {
  const { colorScheme } = useKwTheme();

  return (
    <Toaster position="top-right" theme={colorScheme} richColors closeButton />
  );
}
