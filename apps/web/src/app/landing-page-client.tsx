"use client";

import { ArrowUpRight, Download } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { KnowwMark } from "@/components/knoww-mark";
import {
  KW_PAGE_CLASS,
  KwThemeToggle,
  useKwTheme,
} from "@/components/kw-theme";

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/knoww-prediction-markets/naoaonihikedoiemhbolbnolibpmojgf";

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

// The detected claim that drives the main readout. Every matched market
// below should connect back to something stated here — that pairing is the
// product's core demo.
const CLAIM = {
  source: "x.com/@themacrotake",
  handle: "@themacrotake",
  meta: "2.3K reposts · 2m ago",
  quote:
    "BTC above $120K, Fed pivot in Q1, SPX prints a new all-time high before year-end. Risk-on macro is back.",
};

const MARKET_PREVIEW = [
  {
    q: "Will Bitcoin close above $120K in 2025?",
    yes: "68",
    no: "32",
    vol: "2.4M",
  },
  { q: "Will the Fed cut rates in Q1 2026?", yes: "82", no: "18", vol: "890K" },
  {
    q: "Will the S&P hit a new all-time high this quarter?",
    yes: "71",
    no: "29",
    vol: "610K",
  },
  {
    q: "Will the US enter recession in 2026?",
    yes: "29",
    no: "71",
    vol: "1.8M",
  },
];

// Dimmer "peek" cards flanking the main terminal on wide screens. Mixed
// finance sources — a retail feed on the left, a terminal-style feed on
// the right — to signal coverage across the whole finance surface.
const PEEK_LEFT_MARKETS = [
  { q: "Will NVDA close above $200 this quarter?", yes: "52", no: "48" },
  { q: "Will the 10Y yield drop below 4% by June?", yes: "44", no: "56" },
  { q: "Will gold print a new ATH in 2026?", yes: "63", no: "37" },
];
const PEEK_RIGHT_MARKETS = [
  { q: "Will WTI crude exceed $90 this year?", yes: "29", no: "71" },
  { q: "Will the DXY close below 100 by Q3?", yes: "41", no: "59" },
  { q: "Will oil majors beat earnings this quarter?", yes: "58", no: "42" },
];

// Short archive of recent detections shown below the live readout. Signals
// "this has been running" without any dishonest animation — rows are static
// after mount; only the hero timestamp above ticks in real time. Each entry
// carries a minutes-ago offset; the HH:MM:SS stamp is computed once on mount
// so it stays consistent with the user's actual clock.
const ARCHIVE_PREVIEW = [
  {
    offsetMin: 6,
    src: "bloomberg.com · Markets",
    headline: "$90 oil thesis back on table — OPEC supply cuts tightening",
    matched: 4,
  },
  {
    offsetMin: 24,
    src: "reddit.com · r/wallstreetbets",
    headline: "NVDA earnings Wed — everyone is long the same trade",
    matched: 4,
  },
  {
    offsetMin: 42,
    src: "x.com/@yardeni",
    headline: "Fed pivot by Q1, 10Y below 4%, SPX hitting new ATHs",
    matched: 3,
  },
];

function formatClock(totalSec: number) {
  const sec = ((totalSec % 86400) + 86400) % 86400;
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export default function LandingPageClient() {
  const { theme, toggleTheme } = useKwTheme();

  // Real-time clock for the Live Readout header. Server renders the static
  // fallback ("21:04:31") to keep SSR deterministic; the client replaces it
  // on first mount and ticks every second.
  const [clockTime, setClockTime] = useState("21:04:31");
  // Archive timestamps derived from mount time so they stay consistent with
  // the user's actual clock. Computed once on mount, then static.
  const [archiveTimes, setArchiveTimes] = useState<string[]>(() =>
    ARCHIVE_PREVIEW.map((_, i) => ["20:58:04", "20:41:17", "20:22:39"][i])
  );
  useEffect(() => {
    const compute = () => {
      const d = new Date();
      return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    };
    const base = compute();
    setArchiveTimes(
      ARCHIVE_PREVIEW.map((a) => formatClock(base - a.offsetMin * 60))
    );
    const tick = () => setClockTime(formatClock(compute()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className={`${KW_PAGE_CLASS} fixed inset-0 z-60 overflow-y-auto bg-(--kw-bg) text-(--kw-fg) font-sans`}
      data-theme={theme}
      style={{ colorScheme: theme }}
    >
      <TickerBar />

      <header className="border-b border-(--kw-fg)/10 bg-(--kw-bg)">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <KnowwMark />
              <span className="font-bold text-[15px] tracking-tight">
                Knoww
              </span>
            </div>
            <span className="hidden md:inline-block text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 border-l border-(--kw-fg)/10 pl-6">
              Est. 2026 · Beta
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-[13px]">
            <a
              href="#thesis"
              className="hover:text-(--kw-fg)/60 transition-colors"
            >
              Thesis
            </a>
            <a
              href="#how"
              className="hover:text-(--kw-fg)/60 transition-colors"
            >
              How It Works
            </a>
            <Link
              href="/markets"
              className="hover:text-(--kw-fg)/60 transition-colors"
            >
              Markets →
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <KwThemeToggle theme={theme} onToggle={toggleTheme} />
            <a
              href={CHROME_STORE_URL}
              className="inline-flex items-center gap-2 bg-(--kw-fg) text-(--kw-bg) px-4 py-2 text-[13px] font-medium hover:bg-(--kw-fg)/90 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Add to Chrome
            </a>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative border-b border-(--kw-fg)/10 overflow-hidden">
        {/* ── Editorial statement (text block) ───────────────────────── */}
        <div className="max-w-[1200px] mx-auto px-6 pt-20 md:pt-28 pb-10 md:pb-14">
          <div className="max-w-[880px]">
            <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-(--kw-fg)/60 mb-8">
              <span className="w-1.5 h-1.5 bg-(--kw-accent) animate-pulse" />
              Issue № 01 — The Prediction Layer
            </div>

            <h1 className="font-bold tracking-[-0.035em] leading-[0.92] text-[56px] sm:text-[80px] md:text-[96px] lg:text-[112px] mb-8">
              <span className="kw-stagger" style={{ animationDelay: "60ms" }}>
                Every
              </span>{" "}
              <span className="kw-stagger" style={{ animationDelay: "160ms" }}>
                opinion,
              </span>
              <br />
              <span className="kw-stagger" style={{ animationDelay: "260ms" }}>
                a
              </span>{" "}
              <span
                className="kw-stagger kw-tilt italic kw-editorial"
                style={{ animationDelay: "360ms" }}
              >
                position
              </span>
              <span className="kw-stagger" style={{ animationDelay: "460ms" }}>
                .
              </span>
            </h1>

            <p className="text-lg text-(--kw-fg)/70 max-w-[560px] leading-[1.55] mb-10">
              Knoww reads the internet alongside you. When a claim, prediction,
              or forecast surfaces — on X, Reddit, Bloomberg, anywhere — we
              quietly surface the matching Polymarket and let you take the other
              side in one click.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <a
                href={CHROME_STORE_URL}
                className="inline-flex items-center gap-2.5 bg-(--kw-fg) text-(--kw-bg) px-7 py-4 text-[14px] font-semibold hover:bg-(--kw-fg)/90 transition-colors group"
              >
                <Download className="w-4 h-4" />
                Install the Extension
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
        </div>

        {/* ── The Stage: full-width product demo with flanking peek cards ── */}
        <div className="relative pb-24 md:pb-32">
          {/* Soft accent-tinted glow behind the stage */}
          <div aria-hidden className="kw-stage-glow" />

          {/* Stage caption — small-caps label floating above the cards */}
          <div className="max-w-[1400px] mx-auto px-6 mb-6 flex items-center justify-center gap-2">
            <span className="w-1 h-1 rounded-full bg-(--kw-accent) animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-(--kw-fg)/60">
              Live product · matching against the order book in real time
            </span>
          </div>

          {/* Card cluster */}
          <div className="relative mx-auto flex justify-center items-start px-6 min-h-[440px] md:min-h-[500px]">
            {/* ── Peek LEFT (hidden on small screens) ── */}
            <aside
              aria-hidden
              className="hidden xl:block absolute top-16 left-[max(24px,calc(50%-660px))] w-[300px] -rotate-[4deg] transform-gpu pointer-events-none"
            >
              <div className="border border-(--kw-fg)/15 bg-(--kw-bg-card) shadow-[0_18px_48px_-24px_rgba(0,0,0,0.25)]">
                <div className="px-3 py-2 border-b border-(--kw-fg)/10 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-(--kw-accent)" />
                  <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
                    Reddit · r/wallstreetbets
                  </span>
                </div>
                <div className="divide-y divide-(--kw-fg)/10">
                  {PEEK_LEFT_MARKETS.map((m) => (
                    <div
                      key={m.q}
                      className="px-3 py-2.5 flex items-center gap-3"
                    >
                      <p className="flex-1 text-[11px] leading-[1.35] text-(--kw-fg)/80">
                        {m.q}
                      </p>
                      <span className="font-mono text-[10px] text-(--kw-accent-text) font-semibold tabular-nums">
                        {m.yes}¢
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>

            {/* ── Main terminal (the hero) ── */}
            <div className="relative z-10 w-full max-w-[760px]">
              <div className="border border-(--kw-fg)/20 bg-(--kw-bg-card) shadow-[0_40px_90px_-32px_rgba(0,0,0,0.38)]">
                <div className="px-5 py-3 border-b border-(--kw-fg)/10 flex items-center justify-between bg-(--kw-fg)/2">
                  <div className="flex items-center gap-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-(--kw-accent) animate-pulse" />
                    <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/70">
                      Knoww — Live Readout
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] font-mono text-(--kw-fg)/60 tabular-nums">
                    <span suppressHydrationWarning>{clockTime}</span>
                    <span className="hidden sm:inline text-(--kw-fg)/30">
                      ·
                    </span>
                    <span className="hidden sm:inline uppercase tracking-[0.18em]">
                      Live
                    </span>
                  </div>
                </div>

                {/* Claim block — the tweet that triggered the match. This is
                    the "reading the internet" half of the value prop; the
                    table below is the "see the matching market" half. */}
                <div className="px-5 py-4 border-b border-(--kw-fg)/10 bg-(--kw-fg)/1.5">
                  <div className="flex items-center gap-2 mb-3 text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/55">
                    <span className="w-1 h-1 rounded-full bg-(--kw-accent)" />
                    <span>Claim detected</span>
                    <span className="text-(--kw-fg)/25">·</span>
                    <span className="normal-case tracking-widest">
                      {CLAIM.source}
                    </span>
                  </div>
                  <p className="kw-editorial italic text-[17px] sm:text-[18px] leading-[1.45] text-(--kw-fg)/92 max-w-[580px]">
                    &ldquo;{CLAIM.quote}&rdquo;
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-[11px] font-mono text-(--kw-fg)/55">
                    <span className="text-(--kw-fg)/75">{CLAIM.handle}</span>
                    <span className="text-(--kw-fg)/25">·</span>
                    <span>{CLAIM.meta}</span>
                  </div>
                </div>

                <div className="divide-y divide-(--kw-fg)/10">
                  <div className="px-5 py-3 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.12em] text-(--kw-fg)/60">
                    <span>Matched Markets</span>
                    <span className="flex gap-6 sm:gap-10">
                      <span className="w-10 text-right">YES</span>
                      <span className="w-10 text-right">NO</span>
                      <span className="hidden sm:inline w-12 text-right">
                        VOL
                      </span>
                    </span>
                  </div>
                  {MARKET_PREVIEW.map((m) => (
                    <div
                      key={m.q}
                      className="px-5 py-4 grid grid-cols-[1fr_auto] gap-4 hover:bg-(--kw-fg)/2 transition-colors"
                    >
                      <p className="text-[14px] leading-[1.45] text-(--kw-fg)/90">
                        {m.q}
                      </p>
                      <div className="flex items-center gap-6 sm:gap-10 font-mono text-[14px] tabular-nums">
                        <span className="text-(--kw-accent-text) font-semibold w-10 text-right">
                          {m.yes}¢
                        </span>
                        <span className="text-(--kw-danger-text) w-10 text-right">
                          {m.no}¢
                        </span>
                        <span className="hidden sm:inline text-(--kw-fg)/60 w-12 text-right">
                          {m.vol}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-5 py-3 border-t border-(--kw-fg)/10 bg-(--kw-fg)/2 flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/60">
                    {MARKET_PREVIEW.length} matched · live
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)">
                    Trade
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* Prior detections — a short static archive of recent claims.
                    Honest: only the hero clock above ticks; these rows just
                    stagger-fade in on first mount to feel like logs landing. */}
                <div className="px-5 py-3 border-t border-(--kw-fg)/10 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/55">
                  <span className="w-1 h-1 rounded-full bg-(--kw-fg)/35 animate-pulse" />
                  <span>Prior detections</span>
                  <span className="text-(--kw-fg)/20">·</span>
                  <span>past 45 min</span>
                </div>
                <div className="divide-y divide-(--kw-fg)/10">
                  {ARCHIVE_PREVIEW.map((a, i) => (
                    <div
                      key={a.headline}
                      className="px-5 py-2.5 grid grid-cols-[auto_1fr_auto] items-baseline gap-4 hover:bg-(--kw-fg)/2 transition-colors"
                      style={{
                        opacity: 0,
                        transform: "translateY(8px)",
                        animation: `kwStaggerIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) ${400 + i * 140}ms forwards`,
                      }}
                    >
                      <span
                        suppressHydrationWarning
                        className="font-mono text-[11px] tabular-nums text-(--kw-fg)/55"
                      >
                        {archiveTimes[i]}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] leading-[1.4] text-(--kw-fg)/85">
                          {a.headline}
                        </p>
                        <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-(--kw-fg)/45">
                          {a.src}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-(--kw-fg)/55 tabular-nums">
                        {a.matched} matched
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Peek RIGHT (hidden on small screens) ── */}
            <aside
              aria-hidden
              className="hidden xl:block absolute top-24 right-[max(24px,calc(50%-660px))] w-[300px] rotate-[4deg] transform-gpu pointer-events-none"
            >
              <div className="border border-(--kw-fg)/15 bg-(--kw-bg-card) shadow-[0_18px_48px_-24px_rgba(0,0,0,0.25)]">
                <div className="px-3 py-2 border-b border-(--kw-fg)/10 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-(--kw-accent)" />
                  <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
                    Bloomberg · Markets
                  </span>
                </div>
                <div className="divide-y divide-(--kw-fg)/10">
                  {PEEK_RIGHT_MARKETS.map((m) => (
                    <div
                      key={m.q}
                      className="px-3 py-2.5 flex items-center gap-3"
                    >
                      <p className="flex-1 text-[11px] leading-[1.35] text-(--kw-fg)/80">
                        {m.q}
                      </p>
                      <span className="font-mono text-[10px] text-(--kw-accent-text) font-semibold tabular-nums">
                        {m.yes}¢
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* BY THE NUMBERS (PROBLEM) — asymmetric grid, italic units, footnote marks */}
      <section className="border-b border-(--kw-fg)/10 bg-(--kw-bg-alt)">
        <div className="max-w-[1200px] mx-auto px-6 py-20">
          <div className="kw-reveal flex items-baseline justify-between border-b border-(--kw-fg)/15 pb-5 mb-14">
            <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              § I. The gap we&apos;re closing
            </h2>
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              P. 01 / 03
            </span>
          </div>

          {/* Asymmetric 12-col grid: first two stats each take 4 cols, third
              stat (the prize) takes 4 cols but at dramatically larger type. */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-0 border-t border-(--kw-fg)/15">
            <div className="kw-reveal md:col-span-4 py-12 px-6 md:border-r border-(--kw-fg)/15">
              <div className="flex items-baseline gap-2 mb-1">
                <sup className="kw-editorial italic text-[14px] text-(--kw-fg)/50 font-medium mr-1 -translate-y-2">
                  i
                </sup>
                <span className="font-bold text-6xl md:text-7xl tabular-nums tracking-[-0.04em] leading-none">
                  <CountUp target={4.9} decimals={1} />
                </span>
                <span className="kw-editorial italic text-[20px] md:text-[24px] text-(--kw-fg)/75 ml-1">
                  billion
                </span>
              </div>
              <p className="text-[14px] leading-[1.55] text-(--kw-fg)/65 max-w-[260px] mt-5">
                people post, argue, and predict online every day — each one an
                unrealized market position.
              </p>
            </div>

            <div className="kw-reveal md:col-span-3 py-12 px-6 md:border-r border-(--kw-fg)/15 border-t md:border-t-0">
              <div className="flex items-baseline gap-2 mb-1">
                <sup className="kw-editorial italic text-[14px] text-(--kw-fg)/50 font-medium mr-1 -translate-y-2">
                  ii
                </sup>
                <span className="font-bold text-5xl md:text-6xl tabular-nums tracking-[-0.04em] leading-none">
                  <CountUp target={0.1} decimals={1} />
                </span>
                <span className="kw-editorial italic text-[18px] md:text-[22px] text-(--kw-fg)/75 ml-1">
                  %
                </span>
              </div>
              <p className="text-[14px] leading-[1.55] text-(--kw-fg)/65 max-w-[220px] mt-5">
                of those opinions ever reach a prediction market. The
                signal-to-action gap is the product.
              </p>
            </div>

            <div className="kw-reveal md:col-span-5 py-12 px-6 border-t md:border-t-0">
              <div className="flex items-baseline gap-2 mb-1">
                <sup className="kw-editorial italic text-[15px] text-(--kw-accent-text) font-medium mr-1 -translate-y-3">
                  iii
                </sup>
                <span className="text-(--kw-fg)/55 font-bold text-4xl md:text-5xl tracking-[-0.04em] leading-none">
                  $
                </span>
                <span className="font-bold text-7xl md:text-[128px] tabular-nums tracking-[-0.045em] leading-none">
                  <CountUp target={50} decimals={0} />
                </span>
                <span className="kw-editorial italic text-[24px] md:text-[32px] text-(--kw-fg)/80 ml-2">
                  billion
                </span>
              </div>
              <p className="text-[14px] leading-[1.55] text-(--kw-fg)/65 max-w-[360px] mt-5">
                total prediction market opportunity by 2030, per industry
                forecasts — the market Knoww is building a layer into.
              </p>
            </div>
          </div>

          {/* Editorial citation strip */}
          <div className="kw-reveal mt-10 pt-5 border-t border-(--kw-fg)/10 flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/45">
            <span>
              <span className="kw-editorial italic normal-case tracking-normal text-[12px] text-(--kw-fg)/60 mr-2">
                Sources —
              </span>
              i. Meltwater 2024 · ii. Polymarket usage data · iii. Gartner
              projection
            </span>
            <span>Compiled Q2 2026</span>
          </div>
        </div>
      </section>

      {/* THESIS / SOLUTION */}
      <section id="thesis" className="border-b border-(--kw-fg)/10">
        <div className="max-w-[1200px] mx-auto px-6 py-24 relative">
          {/* Marginalia — editor's note breaking out of the content column
              into the left margin, magazine-style. Only shown on wide screens
              where there's real outer whitespace to work with. */}
          <aside
            aria-label="Editor's note"
            className="hidden xl:block absolute top-28 left-[max(20px,calc(50%-660px))] w-[180px] pl-3 border-l-2 border-(--kw-accent) pointer-events-none"
          >
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/50 mb-1.5">
              Editor&apos;s note
            </p>
            <p className="kw-editorial italic text-[13px] leading-[1.45] text-(--kw-fg)/70">
              A working thesis — subject to revision as the layer matures.
            </p>
          </aside>

          <div className="kw-reveal flex items-baseline justify-between border-b border-(--kw-fg)/15 pb-5 mb-14">
            <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              § II. The thesis
            </h2>
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              P. 02 / 03
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 mb-20">
            <div className="kw-reveal lg:col-span-5">
              <h3 className="text-4xl md:text-5xl font-bold tracking-[-0.03em] leading-[1.02]">
                Predictions live where conversations happen —
                <span className="text-(--kw-fg)/60">
                  {" "}
                  not where markets are.
                </span>
              </h3>
            </div>
            <div className="kw-reveal lg:col-span-6 lg:col-start-7 text-[15px] leading-[1.65] text-(--kw-fg)/70 space-y-4">
              <p>
                Every trading platform asks the same question: come to us, log
                in, find the market, then trade. Knoww inverts it. We meet you
                where you already are — the thread, the tweet, the article — and
                bring the market into view.
              </p>
              <p>
                Think of it as a cursor for public opinion. Hover over a claim,
                see the odds. Decide to trade, do it in one click. No tabs, no
                context switch.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 border-t border-(--kw-fg)/15">
            {[
              {
                n: "A",
                title: "Detect",
                desc: "A lightweight page scanner identifies predictive language — claims, probabilities, timeframes — as you browse.",
              },
              {
                n: "B",
                title: "Match",
                desc: "We cross-reference against the live Polymarket order book and surface the closest tradeable position in under 200ms.",
              },
              {
                n: "C",
                title: "Execute",
                desc: "One click, no redirect. Orders route through the same infrastructure power users already rely on — fully self-custody.",
              },
            ].map((f, i) => (
              <div
                key={f.n}
                className={`kw-reveal py-10 px-6 ${i !== 2 ? "md:border-r border-(--kw-fg)/15" : ""} ${i !== 0 ? "border-t md:border-t-0 border-(--kw-fg)/15" : ""}`}
              >
                <div className="flex items-center gap-3 mb-6">
                  <span className="w-7 h-7 bg-(--kw-fg) text-(--kw-bg) flex items-center justify-center text-[11px] font-mono font-bold">
                    {f.n}
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
                    Phase
                  </span>
                </div>
                <h3 className="text-2xl font-bold mb-3 tracking-[-0.02em]">
                  {f.title}
                </h3>
                <p className="text-[14px] leading-[1.6] text-(--kw-fg)/65">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section
        id="how"
        className="border-b border-(--kw-fg)/10 bg-(--kw-fg) text-(--kw-bg)"
      >
        <div className="max-w-[1200px] mx-auto px-6 py-24">
          <div className="flex items-baseline justify-between border-b border-(--kw-bg)/15 pb-5 mb-14">
            <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-bg)/75">
              § III. Installation to position, in about a minute
            </h2>
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-bg)/70">
              P. 03 / 03
            </span>
          </div>

          <h3 className="kw-reveal text-5xl md:text-6xl font-bold tracking-[-0.035em] leading-[0.98] mb-16 max-w-[900px]">
            Three steps. Claim to position, without leaving the page.
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
            {[
              {
                n: "01",
                roman: "i",
                time: "~30s",
                title: "Install",
                desc: "Add Knoww from the Chrome Web Store. One permission prompt, one click.",
              },
              {
                n: "02",
                roman: "ii",
                time: "Passive",
                title: "Browse",
                desc: "Keep doing what you were doing. A small indicator appears when a market is near.",
              },
              {
                n: "03",
                roman: "iii",
                time: "~5s",
                title: "Trade",
                desc: "Open the panel, pick a side, confirm. Your position is live on-chain.",
              },
            ].map((s, i) => (
              <div
                key={s.n}
                className={`kw-reveal py-8 px-6 ${i !== 2 ? "md:border-r border-(--kw-bg)/15" : ""} ${i !== 0 ? "border-t md:border-t-0 border-(--kw-bg)/15" : ""}`}
              >
                <div className="flex items-end justify-between mb-8">
                  <span
                    aria-hidden
                    className="kw-editorial italic text-[96px] md:text-[112px] leading-[0.75] tracking-[-0.04em] text-(--kw-bg)"
                  >
                    {s.roman}
                  </span>
                  <span className="sr-only">Step {s.n}:</span>
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-accent-inv)">
                    {s.time}
                  </span>
                </div>
                <h3 className="text-2xl font-bold mb-3 tracking-[-0.02em]">
                  {s.title}
                </h3>
                <p className="text-[14px] leading-[1.6] text-(--kw-bg)/75">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-16 pt-8 border-t border-(--kw-bg)/15 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <p className="text-(--kw-bg)/70 text-[14px] max-w-[540px]">
              Self-custody throughout. Your keys, your funds, your trades —
              Knoww never touches any of them.
            </p>
            <a
              href={CHROME_STORE_URL}
              className="inline-flex items-center gap-2.5 bg-(--kw-bg) text-(--kw-fg) px-6 py-3.5 text-[14px] font-semibold hover:bg-(--kw-bg)/85 transition-colors group w-fit"
            >
              <Download className="w-4 h-4" />
              Install Knoww
              <ArrowUpRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </a>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="border-b border-(--kw-fg)/10">
        <div className="max-w-[1200px] mx-auto px-6 py-28">
          <div className="max-w-[860px]">
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 mb-6 block">
              § IV — Install
            </span>
            <h2 className="text-[56px] sm:text-[80px] md:text-[96px] font-bold tracking-[-0.035em] leading-[0.92] mb-10">
              Start reading
              <br />
              the market,
              <br />
              <span className="italic kw-editorial">not around it</span>.
            </h2>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <a
                href={CHROME_STORE_URL}
                className="inline-flex items-center gap-2.5 bg-(--kw-fg) text-(--kw-bg) px-8 py-5 text-[15px] font-semibold hover:bg-(--kw-fg)/90 transition-colors group"
              >
                <Download className="w-4 h-4" />
                Add Knoww to Chrome — Free
                <ArrowUpRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-(--kw-fg)/10 bg-(--kw-bg-alt)">
        {/* Publication-style issue line — editorial flourish at the top of the
            footer, in Fraunces italic to echo the typographic system. */}
        <div className="border-b border-(--kw-fg)/10">
          <div className="max-w-[1200px] mx-auto px-6 py-3 flex flex-col md:flex-row md:items-baseline md:justify-between gap-2 text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/65">
            <span className="flex items-baseline gap-3">
              <span className="kw-editorial italic normal-case tracking-normal text-[13px] text-(--kw-fg)/80">
                № 01 — Winter 2026
              </span>
              <span className="text-(--kw-fg)/25">·</span>
              <span>An inaugural issue on the prediction layer</span>
            </span>
            <span>knoww.app</span>
          </div>
        </div>

        <div className="max-w-[1200px] mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-[13px]">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <KnowwMark size="sm" />
              <span className="font-bold text-[14px]">Knoww</span>
            </div>
            <p className="text-[12px] text-(--kw-fg)/60 leading-[1.55] max-w-[220px]">
              A prediction market layer for the{" "}
              <span className="kw-editorial italic text-(--kw-fg)/80">
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
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Extension
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
            <p className="text-[12px] font-mono text-(--kw-fg)/60 leading-[1.6]">
              № 01 · 2026
              <br />
              Set in Plus Jakarta Sans
              <br />& JetBrains Mono
            </p>
          </div>
        </div>
        <div className="border-t border-(--kw-fg)/10">
          <div className="max-w-[1200px] mx-auto px-6 py-4 flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/60">
            <span>© 2026 Knoww</span>
            <span>Made for the prediction-literate</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function TickerBar() {
  const items = [...TICKER, ...TICKER];
  return (
    <div className="border-b border-(--kw-fg)/10 bg-(--kw-fg) text-(--kw-bg) overflow-hidden">
      <div className="flex items-center h-11">
        <div className="shrink-0 px-5 h-full flex items-center border-r border-(--kw-bg)/15">
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-accent-inv) flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-(--kw-accent) animate-pulse" />
            Live
          </span>
        </div>
        <div className="flex-1 overflow-hidden relative kw-ticker-track">
          <div className="flex gap-12 animate-[ticker_60s_linear_infinite] whitespace-nowrap">
            {items.map((t, i) => (
              <span
                key={`${t.label}-${i}`}
                className="text-[12px] font-mono flex items-center gap-2.5 py-2.5"
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

/**
 * Counts up a number from zero to `target` when it scrolls into view.
 * Uses IntersectionObserver against the viewport (the landing container
 * is fixed, so children's viewport positions update with inner scroll).
 */
function CountUp({
  target,
  decimals = 0,
  duration = 1400,
}: {
  target: number;
  decimals?: number;
  duration?: number;
}) {
  const [displayed, setDisplayed] = useState<string>(
    decimals === 0 ? "0" : `0.${"0".repeat(decimals)}`
  );
  const ref = useRef<HTMLSpanElement>(null);
  const hasRun = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const format = (v: number) =>
      decimals === 0 ? String(Math.round(v)) : v.toFixed(decimals);

    const animate = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - (1 - t) ** 3; // cubic ease-out
        setDisplayed(format(target * eased));
        if (t < 1) requestAnimationFrame(tick);
        else setDisplayed(format(target));
      };
      requestAnimationFrame(tick);
    };

    // Honor reduced-motion preferences by skipping straight to the end.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayed(format(target));
      hasRun.current = true;
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !hasRun.current) {
            hasRun.current = true;
            animate();
            io.disconnect();
          }
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target, decimals, duration]);

  return <span ref={ref}>{displayed}</span>;
}
