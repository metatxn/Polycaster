"use client";

import type { ReactNode } from "react";
import { MainContent } from "@/components/main-content";
import { ThemedToaster } from "@/components/themed-toaster";
import ContextProvider from "@/context";

export function AppRouteProviders({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  return (
    <ContextProvider cookies={cookies}>
      <MainContent>{children}</MainContent>
      <ThemedToaster />
    </ContextProvider>
  );
}
