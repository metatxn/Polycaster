import { createLogger } from "@knoww/logger";
import type { Metadata } from "next";
import { POLYMARKET_API } from "@/constants/polymarket";
import { buildPageMetadata, buildPredictionMarketDescription } from "@/lib/seo";
import MarketDetailClient from "./market-detail-client";

const log = createLogger("market-page");

type Props = {
  params: Promise<{ slug: string }>;
};

interface GammaMarket {
  question: string;
  description?: string;
  volume?: string;
  image?: string;
}

async function getMarket(slug: string): Promise<GammaMarket | null> {
  try {
    const res = await fetch(
      `${POLYMARKET_API.GAMMA.MARKETS}?slug=${encodeURIComponent(
        slug
      )}&closed=false`,
      {
        next: { revalidate: 60 },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as GammaMarket[];
    return data?.[0] || null;
  } catch (error) {
    log.error("metadata.fetch_failed", { error });
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const market = await getMarket(slug);

  if (!market) {
    return {
      title: "Market Not Found",
      description: "The requested market could not be found.",
    };
  }

  return buildPageMetadata({
    title: market.question,
    description: buildPredictionMarketDescription({
      title: market.question,
      fallback: market.description,
    }),
    path: `/markets/${slug}`,
    image: market.image,
    // Event detail pages are the canonical public market surface. Keep this
    // legacy/detail route crawlable for discovery, but out of the index to
    // avoid duplicate Polymarket event/market URLs competing with each other.
    index: false,
  });
}

export default async function MarketDetailPage({ params }: Props) {
  const { slug } = await params;
  return <MarketDetailClient slug={slug} />;
}
