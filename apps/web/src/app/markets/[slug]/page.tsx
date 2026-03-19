import type { Metadata } from "next";
import { POLYMARKET_API } from "@/constants/polymarket";
import MarketDetailClient from "./market-detail-client";

type Props = {
  params: Promise<{ slug: string }>;
};

interface GammaMarket {
  question: string;
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
    console.error("Error fetching market for metadata:", error);
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

  const title = market.question;
  const description = `Trade on this prediction market. Current volume: ${
    market.volume || "N/A"
  }. Explore odds and make your prediction on Knoww.`;

  return {
    title,
    description,
    alternates: {
      canonical: `https://knoww.app/markets/${slug}`,
    },
    openGraph: {
      title,
      description,
      images: market.image ? [market.image] : [],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: market.image ? [market.image] : [],
    },
  };
}

export default async function MarketDetailPage({ params }: Props) {
  const { slug } = await params;
  return <MarketDetailClient slug={slug} />;
}
