import { WalletRouteProviders } from "@/components/wallet-route-providers";
import "@/app/styles/product.css";

export default function AgentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <WalletRouteProviders>{children}</WalletRouteProviders>;
}
