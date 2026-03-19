"use client";

import type { ReactNode } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { useSidebar } from "@/context/sidebar-context";
import { cn } from "@/lib/utils";

interface MainContentProps {
  children: ReactNode;
}

export function MainContent({ children }: MainContentProps) {
  const { isCollapsed } = useSidebar();

  return (
    <div
      className={cn(
        "transition-all duration-300",
        isCollapsed ? "xl:ml-16" : "xl:ml-56"
      )}
    >
      {/* Add bottom padding on mobile to account for bottom nav */}
      <div className="pb-20 xl:pb-0">{children}</div>
      {/* Bottom navigation for mobile */}
      <BottomNav />
    </div>
  );
}
