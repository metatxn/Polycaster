import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import {
  CONTENT_NAV,
  LandingFooter,
  LandingHeader,
} from "@/components/landing/landing-chrome";
import { LandingShell } from "@/components/landing/landing-shell";
import { GUIDES, getGuide } from "@/lib/guides";
import { serializeJsonLd } from "@/lib/json-ld";
import { buildPageMetadata, canonicalUrl, SITE_URL } from "@/lib/seo";
import { HowPredictionMarketsResolve } from "./how-prediction-markets-resolve";
import { HowToReadPredictionMarketOdds } from "./how-to-read-prediction-market-odds";
import { WhatIsAPredictionMarket } from "./what-is-a-prediction-market";
import "../../styles/landing-route.css";

const GUIDE_BODIES: Record<string, ComponentType> = {
  "what-is-a-prediction-market": WhatIsAPredictionMarket,
  "how-to-read-prediction-market-odds": HowToReadPredictionMarketOdds,
  "how-prediction-markets-resolve": HowPredictionMarketsResolve,
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function formatGuideDate(isoDate: string) {
  return DATE_FORMAT.format(new Date(`${isoDate}T00:00:00Z`));
}

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) {
    return {};
  }

  return buildPageMetadata({
    title: guide.title,
    description: guide.description,
    path: `/guides/${guide.slug}`,
  });
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = getGuide(slug);
  const Body = GUIDE_BODIES[slug];
  if (!guide || !Body) {
    notFound();
  }

  const guideUrl = canonicalUrl(`/guides/${guide.slug}`);
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${guideUrl}#article`,
    headline: guide.heading,
    description: guide.description,
    datePublished: guide.datePublished,
    dateModified: guide.dateModified,
    author: {
      "@type": "Organization",
      name: "Knoww editorial team",
      url: SITE_URL,
    },
    publisher: { "@id": `${SITE_URL}/#organization` },
    mainEntityOfPage: guideUrl,
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "Guides",
        item: canonicalUrl("/guides"),
      },
      { "@type": "ListItem", position: 3, name: guide.heading, item: guideUrl },
    ],
  };

  const published = formatGuideDate(guide.datePublished);
  const updated = formatGuideDate(guide.dateModified);
  const otherGuides = GUIDES.filter((entry) => entry.slug !== guide.slug);

  return (
    <LandingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
      <LandingHeader nav={CONTENT_NAV} />

      <main id="content" tabIndex={-1}>
        <article className="max-w-[820px] mx-auto px-6 sm:px-8 py-14 md:py-20">
          <nav
            aria-label="Breadcrumb"
            className="mb-8 text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/60"
          >
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link
                  href="/"
                  className="hover:text-(--kw-fg) transition-colors"
                >
                  Home
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link
                  href="/guides"
                  className="hover:text-(--kw-fg) transition-colors"
                >
                  Guides
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li
                aria-current="page"
                className="text-(--kw-fg)/80 normal-case tracking-normal"
              >
                {guide.heading}
              </li>
            </ol>
          </nav>

          <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-(--kw-fg)/60 mb-4">
            § Guide
          </p>
          <h1 className="text-[32px] sm:text-[40px] font-bold tracking-[-0.03em] leading-[1.08] mb-5">
            {guide.heading}
          </h1>
          <p className="text-[12px] font-mono text-(--kw-fg)/60 border-b border-(--kw-fg)/10 pb-6">
            By the Knoww editorial team · Published {published}
            {updated !== published ? ` · Updated ${updated}` : ""}
          </p>

          <div className="kw-legal kw-guide mt-8">
            <Body />
          </div>

          <footer className="mt-12 border-t border-(--kw-fg)/10 pt-8">
            <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-(--kw-fg)/60 mb-4">
              More guides
            </p>
            <ul className="space-y-2 text-[14px]">
              {otherGuides.map((entry) => (
                <li key={entry.slug}>
                  <Link
                    href={`/guides/${entry.slug}`}
                    className="underline underline-offset-4 decoration-(--kw-fg)/30 hover:decoration-(--kw-fg) transition-colors"
                  >
                    {entry.heading}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[12px] text-(--kw-fg)/60 max-w-[68ch] leading-[1.6]">
              Knoww displays live Polymarket data and does not provide financial
              advice. Prediction-market prices are crowd estimates, not
              guarantees, and trading involves risk of loss.
            </p>
          </footer>
        </article>
      </main>

      <LandingFooter />
    </LandingShell>
  );
}
