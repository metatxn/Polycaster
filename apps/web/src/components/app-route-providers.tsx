"use client";

import type { ReactNode } from "react";
import type { State } from "wagmi";
import { MainContent } from "@/components/main-content";
import { ThemedToaster } from "@/components/themed-toaster";
import ContextProvider from "@/context";

export function AppRouteProviders({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState: State | undefined;
}) {
  return (
    <ContextProvider initialState={initialState}>
      <MainContent>{children}</MainContent>
      <ThemedToaster />
    </ContextProvider>
  );
}
