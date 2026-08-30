import { ArrowUpRight, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  AgentSection,
  ExtensionSection,
  FinalCTASection,
  HowItWorks,
  ProblemSection,
  RadarBlock,
  SolutionSection,
  TractionSection,
  UseCasesSection,
  WhyNowSection,
} from "@/components/landing/knoww-sections";
import {
  CHROME_STORE_URL,
  LandingFooter,
  LandingHeader,
} from "@/components/landing/landing-chrome";
import { LandingPageAnalytics } from "@/components/landing/landing-page-analytics";
import { LandingShell } from "@/components/landing/landing-shell";
import { TweetOverlayHero } from "@/components/tweet-overlay-hero";
import { buildPageMetadata } from "@/lib/seo";
import "./styles/landing-route.css";

// Homepage-specific description (SEO audit §5.4) — 155 chars exactly, the
// truncation ceiling in buildPageMetadata.
const HOME_DESCRIPTION =
  "Knoww surfaces relevant live prediction-market odds on X, Reddit, and news sites, helping you understand what the market believes without leaving the page.";

// `title.absolute` bypasses the root "%s | Knoww" template — the brand is
// already in this title, so the template would render "… | Knoww" twice.
export const metadata: Metadata = {
  ...buildPageMetadata({
    title: "Knoww — Prediction markets for every opinion",
    description: HOME_DESCRIPTION,
    path: "/",
  }),
  title: { absolute: "Knoww — Prediction markets for every opinion" },
};

const TICKER = [
  { label: "BTC-100K-EOY", side: "YES", price: "68¢", delta: "+2" },
  { label: "ELECTION-2028-D", side: "YES", price: "41¢", delta: "-3" },
  { label: "FED-CUT-Q1", side: "YES", price: "82¢", delta: "+5" },
  { label: "SPX-NEW-ATH", side: "NO", price: "27¢", delta: "-1" },
  { label: "MARS-HUMANS-2030", side: "YES", price: "08¢", delta: "+0" },
  { label: "SUPERBOWL-KC", side: "YES", price: "44¢", delta: "+7" },
  { label: "OPENAI-GPT6-Q2", side: "YES", price: "63¢", delta: "+11" },
  { label: "US-RECESSION-2026", side: "NO", price: "71¢", delta: "-4" },
];

export default function LandingPage() {
  return (
    <LandingShell>
      <LandingPageAnalytics />
      <TickerBar />

      <LandingHeader
        nav={[
          {
            label: "Extension",
            href: "/extension",
            analytics: { cta: "nav_extension", destination: "extension_page" },
          },
          {
            label: "How it works",
            href: "#how",
            analytics: { cta: "nav_how_it_works", destination: "page_section" },
          },
          {
            label: "Agent",
            href: "#agent",
            analytics: { cta: "nav_agent", destination: "page_section" },
          },
          {
            label: "Markets →",
            href: "/markets",
            analytics: { cta: "nav_markets", destination: "web_app" },
          },
        ]}
      />

      <main id="content" tabIndex={-1}>
        {/* HERO — heading + right-side artifact preserved per design direction;
            no background grid. */}
        <section
          className="relative flex min-h-[calc(100svh-109px)] items-center border-b border-(--kw-fg)/10 overflow-hidden"
          data-landing-section="hero"
        >
          {/* Hero aurora — SVG fractal-noise (fbm) clouds tinted with the accent,
              the CSS analogue of the old WebGL shader. Two layers drift in
              opposite directions and blend additively (hero-scoped, no WebGL). */}
          <div
            className="kw-hero-aurora pointer-events-none absolute inset-0 z-0 overflow-hidden"
            aria-hidden="true"
          >
            <div className="kw-hero-aurora-noise kw-hero-aurora-noise-a" />
            <div className="kw-hero-aurora-noise kw-hero-aurora-noise-b" />
          </div>
          <div className="kw-stage-glow" />
          <div className="kw-grain" />
          {/* Legibility scrim — a light left-side veil so the aurora still
              shows through on the left; the per-text shadow below does the
              heavy lifting for WCAG contrast. */}
          <div
            className="pointer-events-none absolute inset-0 z-0 bg-linear-to-r from-(--kw-bg)/55 via-(--kw-bg)/30 via-50% to-transparent to-80%"
            aria-hidden="true"
          />
          <div className="kw-hero-inner relative z-1 w-full max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 py-14 sm:px-8 md:py-20 min-[1024px]:max-[1279px]:landscape:py-8">
            {/* Top-align on landscape tablets so the CTA never gets pushed
              below the fold by the tall side-by-side card; desktop (xl) keeps
              the balanced vertical centering. */}
            <div className="grid grid-cols-12 gap-8 xl:gap-12 items-center min-[1024px]:max-[1279px]:landscape:items-start">
              <div className="col-span-12 lg:landscape:col-span-7 xl:col-span-7 [text-shadow:0_2px_22px_var(--kw-bg),0_0_8px_var(--kw-bg)]">
                {/* Keyword-bearing H1 (SEO audit §5.2). Three descending
                    lines — the widest is "Prediction markets" (18ch), which
                    the responsive sizes are tuned against so the block never
                    soft-wraps inside the 7-col text column. */}
                <h1 className="font-bold tracking-[-0.035em] leading-[0.98] text-[38px] sm:text-[52px] md:text-[64px] lg:text-[72px] min-[1024px]:max-[1279px]:landscape:text-[52px] xl:text-[76px] 2xl:text-[88px] mb-6">
                  <span
                    className="kw-stagger"
                    style={{ animationDelay: "60ms" }}
                  >
                    Prediction
                  </span>{" "}
                  <span
                    className="kw-stagger"
                    style={{ animationDelay: "140ms" }}
                  >
                    markets
                  </span>
                  <br />{" "}
                  <span
                    className="kw-stagger"
                    style={{ animationDelay: "220ms" }}
                  >
                    for
                  </span>{" "}
                  <span
                    className="kw-stagger"
                    style={{ animationDelay: "300ms" }}
                  >
                    everything
                  </span>
                  <br />{" "}
                  <span
                    className="kw-stagger"
                    style={{ animationDelay: "380ms" }}
                  >
                    you
                  </span>{" "}
                  <span
                    className="kw-stagger italic kw-editorial"
                    style={{ animationDelay: "460ms" }}
                  >
                    read.
                  </span>
                </h1>

                <p className="text-base md:text-[17px] text-(--kw-fg)/70 max-w-[560px] leading-[1.55] mb-8">
                  Knoww reads the internet alongside you. When a claim,
                  prediction, or forecast surfaces — on X, Reddit, Bloomberg,
                  anywhere — we quietly surface the matching Polymarket and let
                  you take the other side in one click.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                  <a
                    href={CHROME_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-landing-cta="install_extension"
                    data-landing-location="hero"
                    data-landing-destination="chrome_web_store"
                    className="inline-flex items-center gap-2.5 bg-(--kw-fg) text-(--kw-bg) px-7 py-4 text-[14px] font-semibold hover:bg-(--kw-fg)/90 transition-colors group text-shadow-none"
                  >
                    <Download className="w-4 h-4" />
                    Install Knoww — Free
                    <ArrowUpRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </a>
                  <Link
                    href="/markets"
                    data-landing-cta="explore_markets"
                    data-landing-location="hero"
                    data-landing-destination="web_app"
                    className="inline-flex items-center gap-2 text-[14px] font-medium text-(--kw-fg)/70 hover:text-(--kw-fg) px-5 py-4 border-b border-(--kw-fg)/20 hover:border-(--kw-fg) transition-colors"
                  >
                    Or explore markets without installing
                  </Link>
                </div>
              </div>

              {/* Hero artifact visibility + placement (CSS can't read physical
                inches, so we approximate by viewport + orientation):
                  • Hidden by default (phones, small tablets in portrait).
                  • portrait ≥820px → 11"-and-larger tablets (Air 11"=820, Pro
                    11"=834, 12.9"=1024) show it, stacked below the heading
                    (natural for tall/narrow portrait screens).
                  • landscape ≥1024px → tablets rotated horizontal (11"=1194,
                    mini=1133, 10.2"=1080) show it side-by-side with the heading
                    so it never gets pushed below and clipped; phones (≤932) stay
                    hidden.
                  • xl (≥1280px) → desktop side-by-side, as before. */}
              <div className="@container hidden col-span-12 mt-10 min-w-0 min-[820px]:portrait:block lg:landscape:col-span-5 lg:landscape:mt-0 lg:landscape:block xl:col-span-5 xl:mt-0 xl:block">
                <TweetOverlayHero />
              </div>
            </div>
          </div>
        </section>

        {/* Redesigned prediction-layer narrative */}
        <ProblemSection />
        <SolutionSection />
        <ExtensionSection />
        <HowItWorks />
        <RadarBlock />
        <AgentSection />
        <WhyNowSection />
        <UseCasesSection />
        <TractionSection />
        <FinalCTASection chromeStoreUrl={CHROME_STORE_URL} />
      </main>

      <LandingFooter />
    </LandingShell>
  );
}

function TickerBar() {
  const items = [...TICKER, ...TICKER];
  return (
    // data-nosnippet: illustrative demo prices — never search-snippet material.
    <div
      data-nosnippet
      className="border-b border-(--kw-fg)/10 bg-(--kw-fg) text-(--kw-bg) overflow-hidden"
    >
      <div className="flex items-center h-11 min-w-0">
        <div className="shrink-0 px-5 h-full flex items-center border-r border-(--kw-bg)/15">
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-accent-inv) flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-(--kw-accent) animate-pulse" />
            Live
          </span>
        </div>
        <div className="flex-1 min-w-0 overflow-hidden relative kw-ticker-track">
          <div className="flex gap-12 animate-[ticker_60s_linear_infinite] whitespace-nowrap hover:paused focus-within:paused motion-reduce:animate-none">
            {items.map((t, i) => (
              <span
                key={`${t.label}-${i}`}
                className="text-[13px] font-mono flex items-center gap-2.5 py-2.5"
              >
                <span className="text-(--kw-bg)/70">{t.label}</span>
                <span
                  className={
                    t.side === "YES"
                      ? "text-(--kw-accent-inv)"
                      : "text-(--kw-danger-bright)"
                  }
                >
                  {t.side}
                </span>
                <span className="tabular-nums">{t.price}</span>
                <span
                  className={`tabular-nums ${
                    t.delta.startsWith("-")
                      ? "text-(--kw-danger-bright)"
                      : t.delta === "+0"
                        ? "text-(--kw-bg)/70"
                        : "text-(--kw-accent-inv)"
                  }`}
                >
                  {t.delta}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
