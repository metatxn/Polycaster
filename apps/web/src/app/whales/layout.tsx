import { buildPageMetadata } from "@/lib/seo";
import "@/app/styles/product.css";

export const metadata = buildPageMetadata({
  title: "Polymarket Whale Tracker",
  description:
    "Track large Polymarket traders, whale activity, market pressure, and unusual prediction-market positions on Knoww.",
  path: "/whales",
});

export default function WhalesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
