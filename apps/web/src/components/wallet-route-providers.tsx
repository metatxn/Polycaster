import { headers } from "next/headers";
import type { ReactNode } from "react";
import { type Config, cookieToInitialState } from "wagmi";
import { AppRouteProviders } from "@/components/app-route-providers";
import { config } from "@/config";

/**
 * Request-bound wallet state is scoped to product routes so static/editorial
 * pages can remain independent of cookies and the wallet provider bundle.
 */
export async function WalletRouteProviders({
  children,
}: {
  children: ReactNode;
}) {
  const requestHeaders = await headers();
  const initialState = cookieToInitialState(
    config as Config,
    requestHeaders.get("cookie")
  );

  return (
    <AppRouteProviders initialState={initialState}>
      {children}
    </AppRouteProviders>
  );
}
