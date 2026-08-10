import { WalletRouteProviders } from "@/components/wallet-route-providers";
import { buildNoIndexMetadata } from "@/lib/seo";
import "@/app/styles/product.css";

export const metadata = buildNoIndexMetadata({
  title: "Your Portfolio",
  description:
    "Review your private Knoww positions, orders, and trading history.",
});

export default function PortfolioLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <WalletRouteProviders>{children}</WalletRouteProviders>;
}
