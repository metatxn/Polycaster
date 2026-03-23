"use client";

import { polygon } from "@reown/appkit/networks";
import { createAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { type Config, cookieToInitialState, WagmiProvider } from "wagmi";
import { networks, projectId, wagmiAdapter } from "@/config";
import { AccentColorProvider } from "@/context/color-theme-context";
import { EventFilterProvider } from "@/context/event-filter-context";
import { OnboardingProvider } from "@/context/onboarding-context";
import { SidebarProvider } from "@/context/sidebar-context";
import { TradingProvider } from "@/context/trading-context";
import { WalletProvider } from "@/context/wallet-context";

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

// Set up queryClient with default options
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

if (!projectId) {
  throw new Error("Project ID is not defined in context");
}

// Set up metadata
const metadata = {
  name: "Knoww",
  description: "Know your Odds",
  url: "https://knoww.app", // origin must match your domain & subdomain
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

// Create the modal
const _modal = createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks,
  defaultNetwork: polygon, // Set Polygon as default since Polymarket uses it
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
              <SidebarProvider>
                <EventFilterProvider>
                  <OnboardingProvider>
                    <TradingProvider>{children}</TradingProvider>
                  </OnboardingProvider>
                </EventFilterProvider>
              </SidebarProvider>
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
