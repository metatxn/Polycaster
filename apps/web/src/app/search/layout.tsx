import { buildNoIndexMetadata } from "@/lib/seo";
import "@/app/styles/product.css";

export const metadata = buildNoIndexMetadata({
  title: "Search Prediction Markets",
  description: "Search live prediction markets and Polymarket events on Knoww.",
});

export default function SearchLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
