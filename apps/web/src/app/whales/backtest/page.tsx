import { notFound } from "next/navigation";
import { buildNoIndexMetadata } from "@/lib/seo";
import { BacktestClient } from "./backtest-client";

// Internal tuning harness, dev-only: the page 404s outside development (the
// backing /api/whales/backtest route is gated the same way). The noindex
// metadata is belt-and-braces for the dev server itself.
export const metadata = {
  ...buildNoIndexMetadata({
    title: "Insider Detection Backtest",
    description:
      "Internal tool: replay the insider detector against resolved Polymarket markets.",
  }),
  // Drop the /whales canonical inherited from the segment layout. Pairing
  // noindex with a canonical that points at an indexable page is a conflicting
  // signal Google can resolve by de-indexing the target instead.
  alternates: { canonical: null },
};

export default function BacktestPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }
  return <BacktestClient />;
}
