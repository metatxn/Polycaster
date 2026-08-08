import { ArrowUpRight, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  EXTENSION_VERSION,
  FaqSection,
  InstallSection,
  MatchingSection,
  PermissionsSection,
  SupportedSitesSection,
  TradingSection,
} from "@/components/landing/extension-sections";
import { FinalCTASection } from "@/components/landing/knoww-sections";
import {
  CHROME_STORE_URL,
  LandingFooter,
  LandingHeader,
} from "@/components/landing/landing-chrome";
import { LandingShell } from "@/components/landing/landing-shell";
import { serializeJsonLd } from "@/lib/json-ld";
import { buildPageMetadata, canonicalUrl, SITE_URL } from "@/lib/seo";
import "../styles/landing-route.css";

const PAGE_DESCRIPTION =
  "Install the Knoww Chrome extension to see live Polymarket odds on X (Twitter), Reddit, and news sites — matched to what you're reading, as you browse.";

export const metadata: Metadata = buildPageMetadata({
  title: "Prediction Market Browser Extension for X & Reddit",
  description: PAGE_DESCRIPTION,
  path: "/extension",
});

// Only true, on-page-visible values. aggregateRating is omitted (we don't
// display one) and screenshot is omitted (no real screenshot asset exists).
const SOFTWARE_APPLICATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": canonicalUrl("/extension") + "#software",
  name: "Knoww — Every opinion is a position",
  applicationCategory: "BrowserApplication",
  operatingSystem: "Chrome",
  description: PAGE_DESCRIPTION,
  softwareVersion: EXTENSION_VERSION,
  downloadUrl: CHROME_STORE_URL,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: { "@id": `${SITE_URL}/#organization` },
};

const NAV = [
  { label: "Supported sites", href: "#sites" },
  { label: "How it works", href: "#how" },
  { label: "Privacy", href: "#privacy" },
  { label: "Markets →", href: "/markets" },
];

// The named sites from PLATFORMS (knoww-sections.tsx) — the category entries
// ("News sites", "Crypto media", "Finance sites") read as chips, not index
// rows. 7 shown + 43 more = the homepage's "50+ websites" claim; the full,
// current list lives in the extension settings.
const HERO_SITE_INDEX = [
  "X / Twitter",
  "Reddit",
  "Hacker News",
  "Google Search",
  "Bloomberg",
  "Substack",
  "Discord Web",
];

export default function ExtensionPage() {
  return (
    <LandingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(SOFTWARE_APPLICATION_JSONLD),
        }}
      />
      <LandingHeader nav={NAV} />

      <main id="content" tabIndex={-1}>
        {/* HERO — same aurora treatment as the homepage, scaled down for a
            longer, keyword-bearing H1 (audit §6 exact text). Left-aligned
            copy with an editorial sites-index rail on the right (desktop
            only) — the ExtensionPopup demo lives in Supported Sites, so the
            rail is typographic, not a product shot. */}
        <section className="relative flex min-h-[calc(100svh-65px)] items-center border-b border-(--kw-fg)/10 overflow-hidden">
          <div
            className="kw-hero-aurora pointer-events-none absolute inset-0 z-0 overflow-hidden"
            aria-hidden="true"
          >
            <div className="kw-hero-aurora-noise kw-hero-aurora-noise-a" />
            <div className="kw-hero-aurora-noise kw-hero-aurora-noise-b" />
          </div>
          <div className="kw-stage-glow" />
          <div className="kw-grain" />
          <div
            className="pointer-events-none absolute inset-0 z-0 bg-linear-to-r from-(--kw-bg)/55 via-(--kw-bg)/30 via-50% to-transparent to-80%"
            aria-hidden="true"
          />
          {/* Ghost issue numeral — oversized outline "03" bleeding off the
              right edge, the magazine-cover watermark behind the rail. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 -right-8 z-0 hidden -translate-y-1/2 font-bold text-[380px] leading-none tracking-[-0.06em] text-transparent opacity-[0.06] [-webkit-text-stroke:1.5px_var(--kw-fg)] xl:block"
          >
            03
          </div>
          <div className="kw-hero-inner relative z-1 w-full max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 py-14 sm:px-8 md:py-20">
            <div className="grid grid-cols-12 gap-8 xl:gap-12 items-center">
              <div className="col-span-12 xl:col-span-8 [text-shadow:0_2px_22px_var(--kw-bg),0_0_8px_var(--kw-bg)]">
                <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-(--kw-fg)/60 mb-6">
                  <span className="kw-signal-dot w-1.5 h-1.5" />
                  Issue № 03 — The Extension
                </div>

                <h1 className="font-bold tracking-[-0.035em] leading-[1.02] text-[36px] sm:text-[48px] md:text-[58px] lg:text-[64px] mb-6">
                  <span
                    className="kw-stagger"
                    style={{ animationDelay: "60ms" }}
                  >
                    See relevant
                  </span>{" "}
                  <span
                    className="kw-stagger"
                    style={{ animationDelay: "160ms" }}
                  >
                    prediction-market odds
                  </span>
                  <br />
                  <span
                    className="kw-stagger"
                    style={{ animationDelay: "260ms" }}
                  >
                    while you
                  </span>{" "}
                  <span
                    className="kw-stagger italic kw-editorial"
                    style={{ animationDelay: "360ms" }}
                  >
                    browse.
                  </span>
                </h1>

                <p className="text-base md:text-[17px] text-(--kw-fg)/70 max-w-[560px] leading-[1.55] mb-8">
                  The Knoww Chrome extension reads the page you’re on — a post
                  on X, a Reddit thread, a news story — and surfaces live
                  Polymarket odds on that exact question, right where you’re
                  reading.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                  <a
                    href={CHROME_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2.5 bg-(--kw-fg) text-(--kw-bg) px-7 py-4 text-[14px] font-semibold hover:bg-(--kw-fg)/90 transition-colors group [text-shadow:none]"
                  >
                    <Download className="w-4 h-4" />
                    Add to Chrome — Free
                    <ArrowUpRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </a>
                  <Link
                    href="/markets"
                    className="inline-flex items-center gap-2 text-[14px] font-medium text-(--kw-fg)/70 hover:text-(--kw-fg) px-5 py-4 border-b border-(--kw-fg)/20 hover:border-(--kw-fg) transition-colors"
                  >
                    Explore markets first
                  </Link>
                </div>

                {/* Colophon — true build facts in the magazine's spec-line
                    register. Version is sourced from the manifest. */}
                <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-[0.2em] text-(--kw-fg)/50">
                  <span>v{EXTENSION_VERSION}</span>
                  <span aria-hidden="true" className="text-(--kw-fg)/25">
                    ·
                  </span>
                  <span>Manifest V3</span>
                  <span aria-hidden="true" className="text-(--kw-fg)/25">
                    ·
                  </span>
                  <span>Chrome</span>
                  <span aria-hidden="true" className="text-(--kw-fg)/25">
                    ·
                  </span>
                  <span>50+ sites</span>
                </div>
              </div>

              {/* Sites index — a typographic right rail in the magazine
                  register (mono index rows, hairline rules, signal dots).
                  Desktop-only: below xl the left-aligned copy carries the
                  hero on its own, same as the homepage without its artifact. */}
              <div className="hidden xl:col-span-4 xl:block">
                <div className="relative w-full max-w-[360px] ml-auto font-mono [text-shadow:0_2px_22px_var(--kw-bg),0_0_8px_var(--kw-bg)]">
                  {/* Print crop marks framing the index. */}
                  <span
                    aria-hidden="true"
                    className="absolute -top-4 -left-5 text-[10px] text-(--kw-fg)/30"
                  >
                    +
                  </span>
                  <span
                    aria-hidden="true"
                    className="absolute -top-4 -right-5 text-[10px] text-(--kw-fg)/30"
                  >
                    +
                  </span>
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-4 -left-5 text-[10px] text-(--kw-fg)/30"
                  >
                    +
                  </span>
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-4 -right-5 text-[10px] text-(--kw-fg)/30"
                  >
                    +
                  </span>

                  <div
                    className="kw-stagger w-full"
                    style={{ animationDelay: "440ms" }}
                  >
                    <div className="flex items-baseline justify-between pb-4 text-[10px] uppercase tracking-[0.22em] text-(--kw-fg)/60">
                      <span>Index — runs on</span>
                      <span aria-hidden="true">№ 03</span>
                    </div>
                  </div>
                  <ol className="border-t border-(--kw-fg)/10">
                    {HERO_SITE_INDEX.map((site, i) => (
                      <li
                        key={site}
                        className="kw-index-row flex items-center gap-4 border-b border-(--kw-fg)/10 py-3.5 text-[12px] uppercase tracking-[0.18em] text-(--kw-fg)/70"
                        style={{
                          animationDelay: `${520 + i * 90}ms, ${1800 + i * 1200}ms`,
                        }}
                      >
                        <span className="text-[10px] tabular-nums text-(--kw-fg)/45">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="flex-1">{site}</span>
                        <span className="kw-signal-dot w-1.5 h-1.5" />
                      </li>
                    ))}
                  </ol>
                  <div
                    className="kw-stagger w-full"
                    style={{ animationDelay: "1250ms" }}
                  >
                    <a
                      href="#sites"
                      className="group flex items-center justify-between py-3.5 text-[11px] uppercase tracking-[0.18em] text-(--kw-fg)/60 hover:text-(--kw-fg) transition-colors"
                    >
                      <span>+ 43 more sites</span>
                      <span
                        aria-hidden="true"
                        className="transition-transform group-hover:translate-x-0.5"
                      >
                        →
                      </span>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Folio — the printed footer band a magazine spread closes on;
              framed by its own hairline and the section's bottom border. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-1 hidden lg:block">
            <div className="mx-auto flex max-w-[1280px] items-center justify-between border-t border-(--kw-fg)/10 px-6 py-4 font-mono text-[10px] uppercase tracking-[0.22em] text-(--kw-fg)/45 sm:px-8 2xl:max-w-[1440px]">
              <span>Scroll — the field guide</span>
              <span
                aria-hidden="true"
                className="animate-bounce animation-duration-[2s] motion-reduce:animate-none"
              >
                ↓
              </span>
              <span>knoww.app/extension</span>
            </div>
          </div>
        </section>

        <SupportedSitesSection />
        <MatchingSection />
        <PermissionsSection />
        <TradingSection />
        <InstallSection />
        <FaqSection />
        <FinalCTASection
          chromeStoreUrl={CHROME_STORE_URL}
          badge="Free on the Chrome Web Store"
          headingLine1="The internet,"
          headingItalic="with odds attached."
          body="Install Knoww and see live Polymarket odds on the posts, threads, and stories you already read."
          primaryLabel="Add to Chrome — Free"
          secondaryLabel="Explore markets"
          secondaryHref="/markets"
        />
      </main>

      <LandingFooter
        stamp="№ 03 — Summer 2026"
        tagline="A field guide to the extension"
        issueLine="№ 03 · 2026"
      />
    </LandingShell>
  );
}
