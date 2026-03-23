"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";

/**
 * Internal component for sidebar that handles desktop media query detection.
 * This file is dynamically imported by sidebar-desktop.tsx, ensuring the entire
 * Sidebar component tree (and its dependencies) are code-split from the main bundle.
 */
export default function SidebarDesktopInner() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    // Only render sidebar on >= 1280px (desktop). iPad Pro (1024px) should hide it.
    const mql = window.matchMedia("(min-width: 1280px)");
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsDesktop(event.matches);
    };

    // Set initial value
    handleChange(mql);

    // Listen for changes
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  if (!isDesktop) return null;
  return <Sidebar />;
}
