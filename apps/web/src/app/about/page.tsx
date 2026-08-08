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
  "Knoww is the prediction-market layer for the open internet: live Polymarket odds on the web and in your browser, without custody of your funds.";

export const metadata: Metadata = buildPageMetadata({
  title: "About Knoww — Prediction Markets While You Browse",
  description: PAGE_DESCRIPTION,
  path: "/about",
});

export default function AboutPage() {
  const aboutJsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": `${canonicalUrl("/about")}#webpage`,
    name: "About Knoww",
    description: PAGE_DESCRIPTION,
    url: canonicalUrl("/about"),
    isPartOf: { "@id": `${SITE_URL}/#website` },
    mainEntity: { "@id": `${SITE_URL}/#organization` },
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "About",
        item: canonicalUrl("/about"),
      },
    ],
  };

  return (
    <LandingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(aboutJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
      <LandingHeader nav={CONTENT_NAV} />

      <main id="content" tabIndex={-1}>
        <article className="max-w-[820px] mx-auto px-6 sm:px-8 py-14 md:py-20">
          <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-(--kw-fg)/60 mb-4">
            § About
          </p>
          <h1 className="text-[32px] sm:text-[40px] font-bold tracking-[-0.03em] leading-[1.08] mb-5">
            Knoww — prediction markets while you browse
          </h1>

          <div className="kw-legal kw-guide mt-8">
            <p>
              Knoww is a reading layer for prediction markets. It puts live odds
              from{" "}
              <a
                href="https://polymarket.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Polymarket
              </a>{" "}
              — real prices set by traders with money at stake — next to the
              internet you already read: in a{" "}
              <Link href="/markets">live markets feed</Link> on the web, and
              through a <Link href="/extension">browser extension</Link> that
              surfaces relevant markets beside the posts and articles in front
              of you.
            </p>
            <p>
              The premise is simple: on any contested question — an election, a
              rate decision, a match, a launch date — there is usually a market
              where people are backing their beliefs with money, and its price
              is one of the most honest probability estimates available. Knoww
              exists to make that signal as easy to check as a headline.
            </p>

            <h2 id="what-knoww-is">What Knoww is</h2>
            <ul>
              <li>
                <strong>A markets feed.</strong> Live odds across{" "}
                <Link href="/events/politics">politics</Link>,{" "}
                <Link href="/events/crypto">crypto</Link>,{" "}
                <Link href="/events/sports/live">sports</Link>,{" "}
                <Link href="/events/finance">finance</Link>, and more, with
                volume, movement, and each market&rsquo;s written resolution
                rules.
              </li>
              <li>
                <strong>A browser extension.</strong> As you read X, Reddit, and
                news sites, Knoww matches what is on the page to related
                prediction markets and shows the current odds in place — see{" "}
                <Link href="/how-knoww-works">how Knoww works</Link> for the
                full picture.
              </li>
              <li>
                <strong>An editorial standard.</strong> Market rankings on Knoww
                reflect trading activity — volume and recency — not editorial
                judgment. We display what the crowd is pricing, and our{" "}
                <Link href="/guides">guides</Link> teach you to read it
                critically.
              </li>
            </ul>

            <h2 id="what-knoww-is-not">What Knoww is not</h2>
            <p>
              Knoww does not operate, host, or resolve any prediction market,
              and it never takes custody of user funds. Markets run on
              Polymarket under Polymarket&rsquo;s own rules and oracle; trading
              available through Knoww is non-custodial and happens from your own
              wallet. Knoww is not a broker or an advisor, and nothing on this
              site is financial advice — prediction-market prices are crowd
              estimates, not guarantees, and trading involves risk of loss.
            </p>

            <h2 id="contact">Contact</h2>
            <p>
              Questions, feedback, or privacy requests: write to{" "}
              <a href="mailto:contact.us@knoww.app">contact.us@knoww.app</a>.
              For how we handle data, see our{" "}
              <Link href="/privacy">privacy policy</Link>; for the terms that
              govern the product, see the{" "}
              <Link href="/terms">terms of service</Link>.
            </p>
          </div>
        </article>
      </main>

      <LandingFooter />
    </LandingShell>
  );
}
