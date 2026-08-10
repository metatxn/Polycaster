import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppRouteProviders } from "@/components/app-route-providers";

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
  const cookies = requestHeaders.get("cookie");

  return <AppRouteProviders cookies={cookies}>{children}</AppRouteProviders>;
}
