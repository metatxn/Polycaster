"use client";

import { createAppKit } from "@reown/appkit/react";
import { QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useState } from "react";
import { type Config, cookieToInitialState, WagmiProvider } from "wagmi";
import { networks, projectId, wagmiAdapter } from "@/config";
import { AccentColorProvider } from "@/context/color-theme-context";
import { EventFilterProvider } from "@/context/event-filter-context";
import { OnboardingProvider } from "@/context/onboarding-context";
import { TradingProvider } from "@/context/trading-context";
import { WalletProvider } from "@/context/wallet-context";
import { polygon } from "@/lib/chains";
import { getQueryClient } from "@/lib/query-client";

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

if (!projectId) {
  throw new Error("Project ID is not defined in context");
}

function getAppUrl(): string {
  if (typeof window === "undefined") {
    return "https://knoww.app";
  }

  return window.location.origin;
}

// Set up metadata
const metadata = {
  name: "Knoww",
  description: "A prediction market layer for the open internet.",
  url: getAppUrl(), // origin must match the active domain and subdomain
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

// Create the modal
const _modal = createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks,
  defaultNetwork: polygon, // Set Polygon as default since Polymarket uses it
  allowUnsupportedChain: true,
  metadata: metadata,
  features: {
    analytics: true, // Optional - defaults to your Cloud configuration
    //  email: true, // Enable email login
    //socials: ["google", "x", "farcaster"], // Enable social logins
    emailShowWallets: true, // Show other wallets alongside email
  },
});

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
          <AccentColorProvider>
            <WalletProvider>
              <EventFilterProvider>
                <OnboardingProvider>
                  <TradingProvider>{children}</TradingProvider>
                </OnboardingProvider>
              </EventFilterProvider>
            </WalletProvider>
          </AccentColorProvider>
          {process.env.NODE_ENV === "development" && (
            <ReactQueryDevtools initialIsOpen={false} />
          )}
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default ContextProvider;
