"use client";

import type { ReactNode } from "react";
import { BottomNav } from "@/components/bottom-nav";

interface MainContentProps {
  children: ReactNode;
}

export function MainContent({ children }: MainContentProps) {
  return (
    <div>
      {/* Add bottom padding on mobile to account for bottom nav */}
      <div className="pb-20 xl:pb-0">{children}</div>
      {/* Bottom navigation for mobile */}
      <BottomNav />
    </div>
  );
}
