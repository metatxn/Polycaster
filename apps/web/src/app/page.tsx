import type { Metadata } from "next";
import { buildPageMetadata, DEFAULT_SEO_DESCRIPTION } from "@/lib/seo";
import LandingPageClient from "./landing-page-client";

export const metadata: Metadata = buildPageMetadata({
  title: "Knoww — Prediction markets for every opinion",
  description: DEFAULT_SEO_DESCRIPTION,
  path: "/",
});

export default function LandingPage() {
  return <LandingPageClient />;
}
