import { ArrowUpRight, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { KnowwMark } from "@/components/knoww-mark";
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
import { LandingShell } from "@/components/landing/landing-shell";
import { LandingThemeDropdown } from "@/components/landing/landing-theme-dropdown";
import { TweetOverlayHero } from "@/components/tweet-overlay-hero";
import { buildPageMetadata, DEFAULT_SEO_DESCRIPTION } from "@/lib/seo";
import "./styles/landing-route.css";

export const metadata: Metadata = buildPageMetadata({
  title: "Knoww — Prediction markets for every opinion",
  description: DEFAULT_SEO_DESCRIPTION,
  path: "/",
});

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/knoww-%E2%80%94-every-opinion-is/naoaonihikedoiemhbolbnolibpmojgf";

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
      <TickerBar />

      <header className="kw-glass-bar border-b border-(--kw-fg)/10">
        <div className="max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <KnowwMark />
              <span className="font-bold text-[15px] tracking-tight">
                Knoww
              </span>
            </div>
            <span className="hidden lg:inline-block text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 border-l border-(--kw-fg)/10 pl-6 whitespace-nowrap">
              Est. 2026 · Beta
            </span>
          </div>

          <nav className="hidden lg:flex items-center gap-8 text-[14px] font-medium">
            <a
              href="#extension"
              className="inline-flex items-center py-1 hover:text-(--kw-fg)/60 transition-colors"
            >
              Extension
            </a>
            <a
              href="#how"
              className="inline-flex items-center py-1 hover:text-(--kw-fg)/60 transition-colors"
            >
              How it works
            </a>
            <a
              href="#agent"
              className="inline-flex items-center py-1 hover:text-(--kw-fg)/60 transition-colors"
            >
              Agent
            </a>
            <Link
              href="/markets"
              className="inline-flex items-center py-1 hover:text-(--kw-fg)/60 transition-colors"
            >
              Markets →
            </Link>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <LandingThemeDropdown />
            <a
              href={CHROME_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Add to Chrome"
              className="inline-flex items-center gap-2 bg-(--kw-fg) text-(--kw-bg) px-3 py-2 text-[14px] font-medium hover:bg-(--kw-fg)/90 transition-colors whitespace-nowrap sm:px-4"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add to Chrome</span>
            </a>
          </div>
        </div>
      </header>

      <main id="content" tabIndex={-1}>
        {/* HERO — heading + right-side artifact preserved per design direction;
            no background grid. */}
        <section className="relative flex min-h-[calc(100svh-109px)] items-center border-b border-(--kw-fg)/10 overflow-hidden">
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
                <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-(--kw-fg)/60 mb-6">
                  <span className="kw-signal-dot w-1.5 h-1.5" />
                  Issue № 01 — The Prediction Layer
                </div>

                <h1 className="font-bold tracking-[-0.035em] leading-[0.98] text-[44px] sm:text-[60px] md:text-[76px] lg:text-[88px] xl:text-[104px] 2xl:text-[116px] mb-6">
                  <span
                    className="kw-stagger"
                    style={{ animationDelay: "60ms" }}
                  >
                    Every
                  </span>{" "}
                  <span
                    className="kw-stagger"
                    style={{ animationDelay: "160ms" }}
                  >
                    opinion,
                  </span>
                  <br />
                  <span
                    className="kw-stagger"
                    style={{ animationDelay: "260ms" }}
                  >
                    a
                  </span>{" "}
                  <span
                    className="kw-stagger italic kw-editorial"
                    style={{ animationDelay: "360ms" }}
                  >
                    position.
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
                    className="inline-flex items-center gap-2.5 bg-(--kw-fg) text-(--kw-bg) px-7 py-4 text-[14px] font-semibold hover:bg-(--kw-fg)/90 transition-colors group [text-shadow:none]"
                  >
                    <Download className="w-4 h-4" />
                    Install Knoww — Free
                    <ArrowUpRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </a>
                  <Link
                    href="/markets"
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

      {/* FOOTER */}
      <footer className="border-t border-(--kw-fg)/10 bg-(--kw-bg-alt)">
        <div className="border-b border-(--kw-fg)/10">
          <div className="max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 py-3 flex flex-col md:flex-row md:items-baseline md:justify-between gap-2 text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/65">
            <span className="flex items-baseline gap-3">
              <span className="kw-editorial normal-case tracking-normal text-[13px] text-(--kw-fg)/80">
                № 01 — Winter 2026
              </span>
              <span className="text-(--kw-fg)/25">·</span>
              <span>An inaugural issue on the prediction layer</span>
            </span>
            <span>knoww.app</span>
          </div>
        </div>

        <div className="max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-[13px]">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <KnowwMark size="sm" />
              <span className="font-bold text-[14px]">Knoww</span>
            </div>
            <p className="text-[12px] text-(--kw-fg)/70 leading-[1.55] max-w-[220px]">
              The prediction-market layer for the{" "}
              <span className="kw-editorial text-(--kw-fg)/80">
                open internet
              </span>
              .
            </p>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 mb-4">
              Product
            </div>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/markets"
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Markets
                </Link>
              </li>
              <li>
                <a
                  href={CHROME_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Extension
                </a>
              </li>
              <li>
                <a
                  href="#agent"
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Agent
                </a>
              </li>
            </ul>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 mb-4">
              Legal
            </div>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/privacy"
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Privacy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Terms
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 mb-4">
              Issue
            </div>
            <p className="text-[12px] font-mono text-(--kw-fg)/70 leading-[1.6]">
              № 01 · 2026
              <br />
              Set in Plus Jakarta Sans
              <br />& JetBrains Mono
            </p>
          </div>
        </div>
        <div className="border-t border-(--kw-fg)/10">
          <div className="max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 py-4 flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/70">
            <span>© 2026 Knoww</span>
            <span>Made for the prediction-literate</span>
          </div>
        </div>
      </footer>
    </LandingShell>
  );
}

function TickerBar() {
  const items = [...TICKER, ...TICKER];
  return (
    <div className="border-b border-(--kw-fg)/10 bg-(--kw-fg) text-(--kw-bg) overflow-hidden">
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
