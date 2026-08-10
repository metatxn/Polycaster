import { WalletRouteProviders } from "@/components/wallet-route-providers";
import { buildNoIndexMetadata } from "@/lib/seo";
import "@/app/styles/product.css";

export const metadata = buildNoIndexMetadata({
  title: "Trader Profile",
  description:
    "View public Polymarket trading activity and performance on Knoww.",
});

export default function ProfileLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <WalletRouteProviders>{children}</WalletRouteProviders>;
}
