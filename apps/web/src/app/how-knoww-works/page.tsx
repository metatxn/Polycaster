import type { Metadata } from "next";
import Link from "next/link";
import {
  CONTENT_NAV,
  LandingFooter,
  LandingHeader,
} from "@/components/landing/landing-chrome";
import { LandingShell } from "@/components/landing/landing-shell";
import { serializeJsonLd } from "@/lib/json-ld";
import { buildPageMetadata, canonicalUrl, SITE_URL } from "@/lib/seo";
import "../styles/landing-route.css";

const PAGE_DESCRIPTION =
  "How Knoww connects what you read to live prediction markets: where the odds come from, how the extension matches pages to markets, and how non-custodial trading works.";

export const metadata: Metadata = buildPageMetadata({
  title: "How Knoww Works",
  description: PAGE_DESCRIPTION,
  path: "/how-knoww-works",
});

export default function HowKnowwWorksPage() {
  const pageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${canonicalUrl("/how-knoww-works")}#webpage`,
    name: "How Knoww works",
    description: PAGE_DESCRIPTION,
    url: canonicalUrl("/how-knoww-works"),
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#organization` },
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "How Knoww works",
        item: canonicalUrl("/how-knoww-works"),
      },
    ],
  };

  return (
    <LandingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
      <LandingHeader nav={CONTENT_NAV} />

      <main id="content" tabIndex={-1}>
        <article className="max-w-[820px] mx-auto px-6 sm:px-8 py-14 md:py-20">
          <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-(--kw-fg)/60 mb-4">
            § How it works
          </p>
          <h1 className="text-[32px] sm:text-[40px] font-bold tracking-[-0.03em] leading-[1.08] mb-5">
            How Knoww connects internet conversations to prediction markets
          </h1>

          <div className="kw-legal kw-guide mt-8">
            <p>
              Most of the internet argues about the future; prediction markets
              price it. Knoww&rsquo;s job is to close the gap between the two —
              so the article you are reading and the market that prices its
              outcome sit side by side. Here is the whole system, end to end.
            </p>

            <h2 id="where-odds-come-from">Where the odds come from</h2>
            <p>
              Every price on Knoww comes from live{" "}
              <a
                href="https://polymarket.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Polymarket
              </a>{" "}
              order books — real bids and offers from traders risking their own
              money. Knoww does not model, adjust, or editorialize the numbers:
              a market showing 62% is showing the crowd&rsquo;s current price
              for a $1 claim on that outcome, nothing more. If that framing is
              new to you, start with{" "}
              <Link href="/guides/what-is-a-prediction-market">
                what is a prediction market
              </Link>
              .
            </p>

            <h2 id="the-feed">The markets feed</h2>
            <p>
              The <Link href="/markets">markets feed</Link> tracks thousands of
              live markets, ranked by trading activity — volume and recency, not
              editorial judgment. Category pages such as{" "}
              <Link href="/events/politics">politics</Link>,{" "}
              <Link href="/events/crypto">crypto</Link>, and{" "}
              <Link href="/events/sports/live">sports</Link> narrow the field,
              and each event page shows the price history, volume, liquidity,
              and the written resolution rules that decide how the market
              settles. Closed events remain visible with their final odds while
              settlement completes — the difference matters, and{" "}
              <Link href="/guides/how-prediction-markets-resolve">
                how prediction markets resolve
              </Link>{" "}
              explains it.
            </p>

            <h2 id="the-extension">The extension: matching pages to markets</h2>
            <p>
              The <Link href="/extension">Knoww browser extension</Link> brings
              the same data to where you already read. As you scroll X, Reddit,
              or a news site, it compares the text of posts and headlines
              against live market titles and topics, and when the match is
              strong enough, shows a compact card with the current odds — right
              next to the conversation. The matching is algorithmic and tuned to
              be conservative: no card is better than a wrong card. What the
              extension can read and what leaves your browser is documented
              plainly in the <Link href="/privacy">privacy policy</Link> and on
              the <Link href="/extension">extension page</Link>.
            </p>

            <h2 id="trading">Trading, without custody</h2>
            <p>
              Reading is free and requires no account. If you choose to trade,
              Knoww is non-custodial: orders are placed on Polymarket from your
              own wallet, and Knoww never holds your funds. Trading&rsquo;s
              built-in cost is the market&rsquo;s spread — the gap between the
              buying and selling price — which{" "}
              <Link href="/guides/how-to-read-prediction-market-odds">
                how to read prediction-market odds
              </Link>{" "}
              covers in detail. Knoww does not operate, host, or resolve any
              market; markets run on Polymarket under Polymarket&rsquo;s own
              rules and oracle.
            </p>

            <h2 id="in-short">In short</h2>
            <ul>
              <li>
                <strong>Data:</strong> live Polymarket order books, shown as-is.
              </li>
              <li>
                <strong>Web:</strong> a feed and category pages ranked by
                trading activity.
              </li>
              <li>
                <strong>Extension:</strong> algorithmic matching of what you
                read to relevant markets.
              </li>
              <li>
                <strong>Trading:</strong> optional, non-custodial, from your own
                wallet on Polymarket.
              </li>
              <li>
                <strong>Knoww&rsquo;s role:</strong> display and context — never
                custody, market operation, or resolution.
              </li>
            </ul>
            <p>
              Curious who is behind it? See{" "}
              <Link href="/about">about Knoww</Link>, or dive into the{" "}
              <Link href="/guides">guides</Link> to learn to read the markets
              themselves.
            </p>
          </div>
        </article>
      </main>

      <LandingFooter />
    </LandingShell>
  );
}
