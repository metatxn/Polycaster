import type { Metadata } from "next";
import Link from "next/link";
import {
  CONTENT_NAV,
  LandingFooter,
  LandingHeader,
} from "@/components/landing/landing-chrome";
import { LandingShell } from "@/components/landing/landing-shell";
import { GUIDES } from "@/lib/guides";
import { serializeJsonLd } from "@/lib/json-ld";
import { buildPageMetadata, canonicalUrl, SITE_URL } from "@/lib/seo";
import "../styles/landing-route.css";

const PAGE_DESCRIPTION =
  "Plain-English guides to prediction markets: what they are, how to read the odds, and how markets resolve — written for people who read markets on Knoww.";

export const metadata: Metadata = buildPageMetadata({
  title: "Prediction Market Guides",
  description: PAGE_DESCRIPTION,
  path: "/guides",
});

export default function GuidesPage() {
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${canonicalUrl("/guides")}#collection`,
    name: "Prediction Market Guides",
    description: PAGE_DESCRIPTION,
    url: canonicalUrl("/guides"),
    isPartOf: { "@id": `${SITE_URL}/#website` },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: GUIDES.map((guide, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: guide.title,
        url: canonicalUrl(`/guides/${guide.slug}`),
      })),
    },
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
    ],
  };

  return (
    <LandingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(collectionJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
      <LandingHeader nav={CONTENT_NAV} />

      <main id="content" tabIndex={-1}>
        <div className="max-w-[820px] mx-auto px-6 sm:px-8 py-14 md:py-20">
          <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-(--kw-fg)/60 mb-4">
            § Guides
          </p>
          <h1 className="text-[32px] sm:text-[40px] font-bold tracking-[-0.03em] leading-[1.08] mb-5">
            Prediction markets, explained
          </h1>
          <p className="text-[15px] text-(--kw-fg)/75 leading-[1.65] max-w-[62ch] mb-12">
            Short, plain-English guides to reading prediction markets: what the
            prices mean, where they come from, and what happens when a market
            ends. No jargon assumed, no hype offered.
          </p>

          <ul className="divide-y divide-(--kw-fg)/10 border-y border-(--kw-fg)/10">
            {GUIDES.map((guide, index) => (
              <li key={guide.slug}>
                <Link
                  href={`/guides/${guide.slug}`}
                  className="group grid grid-cols-[auto_1fr] gap-x-5 sm:gap-x-8 py-7"
                >
                  <span className="text-[12px] font-mono text-(--kw-fg)/50 pt-1">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <span className="block text-[18px] sm:text-[20px] font-bold tracking-[-0.02em] leading-[1.25] group-hover:text-(--kw-fg)/70 transition-colors">
                      {guide.heading}
                    </span>
                    <span className="block mt-2 text-[13px] text-(--kw-fg)/70 leading-[1.6] max-w-[62ch]">
                      {guide.description}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-10 text-[13px] text-(--kw-fg)/70 leading-[1.6] max-w-[62ch]">
            Prefer to learn by looking? The{" "}
            <Link
              href="/markets"
              className="underline underline-offset-4 decoration-(--kw-fg)/30 hover:decoration-(--kw-fg) transition-colors"
            >
              live markets feed
            </Link>{" "}
            shows every concept in these guides on real, open markets — or read{" "}
            <Link
              href="/how-knoww-works"
              className="underline underline-offset-4 decoration-(--kw-fg)/30 hover:decoration-(--kw-fg) transition-colors"
            >
              how Knoww works
            </Link>{" "}
            for the tour of the product itself.
          </p>
        </div>
      </main>

      <LandingFooter />
    </LandingShell>
  );
}
