"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const AppRouteProviders = dynamic(
  () =>
    import("@/components/app-route-providers").then(
      (mod) => mod.AppRouteProviders
    ),
  { ssr: true }
);

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
