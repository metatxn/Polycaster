"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion } from "framer-motion";
import dynamic from "next/dynamic";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useState } from "react";
import { type Config, cookieToInitialState, WagmiProvider } from "wagmi";
import { wagmiAdapter } from "@/config";
import { EventFilterProvider } from "@/context/event-filter-context";
import { OnboardingProvider } from "@/context/onboarding-context";
import { TradingProvider } from "@/context/trading-context";
import { WalletProvider } from "@/context/wallet-context";
import { getQueryClient } from "@/lib/query-client";

const loadMotionFeatures = () =>
  import("@/lib/motion-features").then((mod) => mod.default);

/** Devtools are dev-only; the dynamic import + the NODE_ENV guard make sure
 *  the package is never pulled into the production bundle. */
const ReactQueryDevtools =
  process.env.NODE_ENV === "production"
    ? () => null
    : dynamic(
        () =>
          import("@tanstack/react-query-devtools").then(
            (m) => m.ReactQueryDevtools
          ),
        { ssr: false }
      );

// All available themes for next-themes
const ALL_THEMES = [
  "light",
  "dark",
  "midnight",
  "ocean",
  "slate",
  "softpop",
  "sunset",
  "forest",
  "lavender",
];

function ContextProvider({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const initialState = cookieToInitialState(
    wagmiAdapter.wagmiConfig as Config,
    cookies
  );

  /** Lazy-init so each SSR render gets its own client; the browser side
   *  reuses the singleton via `getQueryClient`. */
  const [queryClient] = useState(getQueryClient);

  return (
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig as Config}
      initialState={initialState}
    >
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          themes={ALL_THEMES}
          disableTransitionOnChange
        >
          <LazyMotion features={loadMotionFeatures} strict>
            <WalletProvider>
              <EventFilterProvider>
                <OnboardingProvider>
                  <TradingProvider>{children}</TradingProvider>
                </OnboardingProvider>
              </EventFilterProvider>
            </WalletProvider>
          </LazyMotion>
          {process.env.NODE_ENV === "development" && (
            <ReactQueryDevtools initialIsOpen={false} />
          )}
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default ContextProvider;
