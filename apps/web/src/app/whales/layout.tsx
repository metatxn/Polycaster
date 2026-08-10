import { WalletRouteProviders } from "@/components/wallet-route-providers";
import { buildPageMetadata, TITLE_TEMPLATE } from "@/lib/seo";
import "@/app/styles/product.css";

export const metadata = {
  ...buildPageMetadata({
    title: "Polymarket Whale Tracker",
    description:
      "Track large Polymarket traders, whale activity, market pressure, and unusual prediction-market positions on Knoww.",
    path: "/whales",
  }),
  // Re-declare the brand template so child routes (e.g. /whales/backtest)
  // keep the "… | Knoww" suffix — a plain-string title here would drop it.
  title: {
    default: "Polymarket Whale Tracker",
    template: TITLE_TEMPLATE,
  },
};

export default function WhalesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <WalletRouteProviders>{children}</WalletRouteProviders>;
}
