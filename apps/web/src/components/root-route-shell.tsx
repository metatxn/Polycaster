"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppRouteProviders } from "@/components/app-route-providers";

export function RootRouteShell({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const pathname = usePathname();

  if (pathname === "/") {
    return <>{children}</>;
  }

  return <AppRouteProviders cookies={cookies}>{children}</AppRouteProviders>;
}
