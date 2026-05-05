"use client";

import { ArrowUpRight, Check, Download, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { KnowwMark } from "@/components/knoww-mark";
import {
  KW_PAGE_CLASS,
  KwThemeToggle,
  useKwTheme,
} from "@/components/kw-theme";
import { TweetOverlayHero } from "@/components/tweet-overlay-hero";

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

// Feature checks for the "same scroll, with odds" section. Three short
// promises that map back to the three pillars of the experience.
const SAME_SCROLL_FEATURES = [
  "Auto-detects context — tweets, headlines, threads, replies",
  "Live Polymarket odds, volume & resolution rules",
  "Trade in one click — without leaving the page",
];

// Constellation pills for the Coverage section. Coordinates sit ON the
// dotted rings (computed from each ring's rx/ry around centre 50,55),
// not floating near them — so the diagram reads as typeset, not
// hand-arranged. Inner = discussion platforms, middle = media, outer =
// knowledge/culture/professional.
const COVERAGE_PILLS: Array<{ name: string; x: number; y: number }> = [
  // Inner ring — discussion platforms (rx≈26%, ry≈21%)
  { name: "Reddit", x: 41, y: 35 },
  { name: "Hacker News", x: 59, y: 35 },
  { name: "X / Twitter", x: 24, y: 55 },
  { name: "Threads", x: 76, y: 55 },
  { name: "Bluesky", x: 41, y: 75 },
  { name: "Substack", x: 59, y: 75 },
  // Middle ring — media & publications (rx≈38%, ry≈33%)
  { name: "NYT", x: 26, y: 30 },
  { name: "Bloomberg", x: 74, y: 30 },
  { name: "Financial Times", x: 13, y: 49 },
  { name: "Axios", x: 87, y: 49 },
  { name: "Politico", x: 26, y: 80 },
  { name: "The Verge", x: 74, y: 80 },
  // Outer ring — knowledge, culture & professional (rx≈48%, ry≈43%)
  { name: "Wikipedia", x: 3, y: 55 },
  { name: "YouTube", x: 97, y: 55 },
  { name: "ESPN", x: 19, y: 88 },
  { name: "LinkedIn", x: 81, y: 88 },
];

export default function LandingPageClient() {
  const { theme, toggleTheme } = useKwTheme();

  return (
    <div
      className={`${KW_PAGE_CLASS} kw-landing fixed inset-0 z-60 overflow-y-auto bg-(--kw-bg) text-(--kw-fg) font-sans`}
      data-theme={theme}
      style={{ colorScheme: theme }}
    >
      <TickerBar />

      <header className="border-b border-(--kw-fg)/10 bg-(--kw-bg)">
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

          <nav className="hidden lg:flex items-center gap-8 text-[13px]">
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
              className="inline-flex items-center gap-2 bg-(--kw-fg) text-(--kw-bg) px-4 py-2 text-[13px] font-medium hover:bg-(--kw-fg)/90 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Add to Chrome
            </a>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative flex min-h-[calc(100svh-109px)] items-center border-b border-(--kw-fg)/10 overflow-hidden">
        <div className="w-full max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 py-14 sm:px-8 md:py-20">
          {/* 12-col grid: text holds 7/12 on xl+, leaving 5/12 on the right
              for the product artifact that ships separately. On smaller
              viewports the text spans full width. */}
          <div className="grid grid-cols-12 gap-8 xl:gap-12 items-center">
            <div className="col-span-12 xl:col-span-7">
              <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-(--kw-fg)/60 mb-6">
                <span className="w-1.5 h-1.5 bg-(--kw-accent) animate-pulse" />
                Issue № 01 — The Prediction Layer
              </div>

              <h1 className="font-bold tracking-[-0.035em] leading-[0.98] text-[44px] sm:text-[60px] md:text-[76px] lg:text-[88px] xl:text-[104px] 2xl:text-[116px] mb-6">
                <span className="kw-stagger" style={{ animationDelay: "60ms" }}>
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
                  className="inline-flex items-center gap-2.5 bg-(--kw-fg) text-(--kw-bg) px-7 py-4 text-[14px] font-semibold hover:bg-(--kw-fg)/90 transition-colors group"
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

            <div className="hidden sm:col-span-12 sm:mt-10 sm:block xl:col-span-5 xl:mt-0">
              <TweetOverlayHero />
            </div>
          </div>
        </div>
      </section>

      {/* BY THE NUMBERS (PROBLEM) — asymmetric grid, italic units, footnote marks */}
      <section className="border-b border-(--kw-fg)/10 bg-(--kw-bg-alt)">
        <div className="w-full max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 py-20 md:py-28 lg:py-32">
          <div className="kw-reveal flex items-baseline justify-between border-b border-(--kw-fg)/15 pb-5 mb-10">
            <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              § I. The gap we&apos;re closing
            </h2>
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              P. 01 / 05
            </span>
          </div>

          {/* Asymmetric 12-col grid: first two stats each take 4 cols, third
              stat (the prize) takes 4 cols but at dramatically larger type. */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 border-t border-(--kw-fg)/15">
            <div className="kw-reveal lg:col-span-4 py-8 md:py-10 px-6 lg:border-r border-(--kw-fg)/15">
              <div className="flex items-baseline gap-2 mb-1">
                <sup className="kw-editorial italic text-[14px] text-(--kw-fg)/50 font-medium mr-1 -translate-y-2">
                  i
                </sup>
                <span className="font-bold text-6xl md:text-7xl tabular-nums tracking-[-0.04em] leading-none">
                  <CountUp target={4.9} decimals={1} />
                </span>
                <span className="kw-editorial text-[20px] md:text-[24px] text-(--kw-fg)/75 ml-1">
                  billion
                </span>
              </div>
              <p className="text-[14px] leading-[1.55] text-(--kw-fg)/65 max-w-[260px] mt-5">
                people post, argue, and predict online every day — each one an
                unrealized market position.
              </p>
            </div>

            <div className="kw-reveal lg:col-span-3 py-8 md:py-10 px-6 lg:border-r border-(--kw-fg)/15 border-t lg:border-t-0">
              <div className="flex items-baseline gap-2 mb-1">
                <sup className="kw-editorial italic text-[14px] text-(--kw-fg)/50 font-medium mr-1 -translate-y-2">
                  ii
                </sup>
                <span className="font-bold text-5xl md:text-6xl tabular-nums tracking-[-0.04em] leading-none">
                  <CountUp target={0.1} decimals={1} />
                </span>
                <span className="kw-editorial text-[18px] md:text-[22px] text-(--kw-fg)/75 ml-1">
                  %
                </span>
              </div>
              <p className="text-[14px] leading-[1.55] text-(--kw-fg)/65 max-w-[220px] mt-5">
                of those opinions ever reach a prediction market. The
                signal-to-action gap is the product.
              </p>
            </div>

            <div className="kw-reveal lg:col-span-5 py-8 md:py-10 px-6 border-t lg:border-t-0">
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
                <span className="kw-editorial text-[24px] md:text-[32px] text-(--kw-fg)/80 ml-2">
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
          <div className="kw-reveal mt-8 pt-5 border-t border-(--kw-fg)/10 flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/45">
            <span>
              <span className="kw-editorial normal-case tracking-normal text-[12px] text-(--kw-fg)/65 mr-2">
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
        <div className="w-full max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 py-20 md:py-28 lg:py-32 relative">
          <div className="kw-reveal flex items-baseline justify-between border-b border-(--kw-fg)/15 pb-5 mb-8">
            <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              § II. The thesis
            </h2>
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              P. 02 / 05
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-10 mb-10">
            <div className="kw-reveal md:col-span-5">
              <h3 className="text-3xl md:text-4xl font-bold tracking-[-0.03em] leading-[1.04]">
                Predictions live where conversations happen —
                <span className="text-(--kw-fg)/60">
                  {" "}
                  not where markets are.
                </span>
              </h3>
            </div>
            <div className="kw-reveal md:col-span-6 md:col-start-7 text-[15px] leading-[1.65] text-(--kw-fg)/70 space-y-4">
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
                className={`kw-reveal py-7 px-6 ${i !== 2 ? "md:border-r border-(--kw-fg)/15" : ""} ${i !== 0 ? "border-t md:border-t-0 border-(--kw-fg)/15" : ""}`}
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

      {/* SAME SCROLL, WITH ODDS — show, don't tell. The thesis above
          described Detect/Match/Execute in the abstract; this section
          re-enacts it inside a browser-mockup so the value prop is felt,
          not just read. */}
      <section className="border-b border-(--kw-fg)/10">
        <div className="w-full max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 py-20 md:py-28 lg:py-32">
          <div className="kw-reveal flex items-baseline justify-between border-b border-(--kw-fg)/15 pb-5 mb-8">
            <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              § III. In context
            </h2>
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              P. 03 / 05
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12 items-center">
            {/* LEFT — editorial copy + feature checks */}
            <div className="kw-reveal md:col-span-5">
              <h3 className="font-bold tracking-[-0.035em] leading-[0.98] text-[36px] sm:text-[46px] md:text-[50px] mb-5">
                The same scroll.
                <br />
                With{" "}
                <span className="kw-editorial italic kw-tilt text-(--kw-accent-text)">
                  odds.
                </span>
              </h3>
              <p className="text-[15px] leading-[1.6] text-(--kw-fg)/70 max-w-[480px] mb-7">
                When you read a tweet about Bitcoin, an article about an
                election, a Substack on AI — Knoww quietly reads the context,
                fetches the relevant Polymarket market, and shows the current
                odds where you already are.
              </p>
              <ul className="space-y-4">
                {SAME_SCROLL_FEATURES.map((line) => (
                  <li key={line} className="flex items-start gap-3.5">
                    <span className="shrink-0 mt-[3px] w-[18px] h-[18px] rounded-full border border-(--kw-accent)/55 bg-(--kw-accent)/8 flex items-center justify-center">
                      <Check
                        className="w-2.5 h-2.5 text-(--kw-accent-text)"
                        strokeWidth={3}
                      />
                    </span>
                    <span className="text-[14.5px] leading-[1.55] text-(--kw-fg)/85">
                      {line}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* RIGHT — browser mockup with tweet + Knoww panel */}
            <div className="kw-reveal md:col-span-7 relative">
              <div aria-hidden className="kw-stage-glow" />
              <div className="relative border border-(--kw-fg)/15 bg-(--kw-bg-card) shadow-[0_30px_70px_-30px_rgba(0,0,0,0.32)]">
                {/* Browser chrome */}
                <div className="px-4 py-3 border-b border-(--kw-fg)/10 flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-(--kw-fg)/15" />
                    <span className="w-2.5 h-2.5 rounded-full bg-(--kw-fg)/15" />
                    <span className="w-2.5 h-2.5 rounded-full bg-(--kw-fg)/15" />
                  </div>
                  <div className="flex-1 mx-2 h-7 px-3 rounded-md bg-(--kw-fg)/5 border border-(--kw-fg)/10 flex items-center gap-2 text-[11px] font-mono text-(--kw-fg)/55 min-w-0">
                    <Lock className="w-3 h-3 shrink-0" />
                    <span className="truncate">x.com/yardeni/status/…</span>
                  </div>
                  <span className="w-7 h-7 bg-(--kw-accent)/15 border border-(--kw-accent)/30 flex items-center justify-center rounded-sm">
                    <KnowwMark size="sm" />
                  </span>
                </div>

                {/* Body */}
                <div className="p-5 sm:p-6 space-y-4">
                  {/* Tweet card */}
                  <div className="rounded-md border border-(--kw-fg)/15 p-4 sm:p-5 bg-(--kw-bg-card)">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="w-9 h-9 rounded-full bg-(--kw-fg)/8 border border-(--kw-fg)/15 flex items-center justify-center font-mono text-[12px] tracking-wider font-semibold text-(--kw-fg)/75">
                        Y
                      </span>
                      <div className="flex flex-col leading-tight">
                        <span className="text-[14px] font-semibold">
                          Ed Yardeni
                        </span>
                        <span className="text-[12px] font-mono text-(--kw-fg)/50">
                          @yardeni · 2m
                        </span>
                      </div>
                    </div>
                    <p className="text-[14.5px] sm:text-[15px] leading-[1.55] text-(--kw-fg)/90">
                      <span className="font-semibold">BREAKING:</span>{" "}
                      Disinflation back on track. Markets pricing a Fed cut as
                      early as <span className="font-semibold">Q1 2026</span> —
                      and history says momentum compounds once the cycle turns.
                    </p>
                    <div className="mt-3.5 flex items-center gap-6 text-[11px] font-mono text-(--kw-fg)/50 tabular-nums">
                      <span>1.2K</span>
                      <span>4.8K</span>
                      <span>22K</span>
                    </div>
                  </div>

                  {/* Knoww panel — inverted */}
                  <div className="rounded-md border border-(--kw-fg)/30 bg-(--kw-fg) text-(--kw-bg) overflow-hidden">
                    <div className="px-4 sm:px-5 py-3 border-b border-(--kw-bg)/15 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-(--kw-accent-inv) animate-pulse" />
                        <span className="w-5 h-5 bg-(--kw-accent)/20 border border-(--kw-accent)/40 flex items-center justify-center rounded-[3px]">
                          <KnowwMark size="sm" />
                        </span>
                        <span className="font-bold text-[13px]">Knoww</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-(--kw-bg)/60">
                        <span>Polymarket</span>
                        <span className="text-(--kw-bg)/25 hidden sm:inline">
                          ·
                        </span>
                        <span className="tabular-nums hidden sm:inline">
                          8.4M VOL
                        </span>
                      </div>
                    </div>
                    <div className="px-4 sm:px-5 pt-4 pb-5">
                      <h4 className="text-[18px] sm:text-[20px] font-bold tracking-[-0.02em] leading-[1.22] mb-4 max-w-[460px]">
                        Will the Fed cut rates by Q1 2026?
                      </h4>

                      {/* Odds bar — single bar split YES / NO */}
                      <div className="relative h-[36px] rounded-sm overflow-hidden bg-(--kw-bg)/12">
                        <div
                          className="absolute inset-y-0 left-0 bg-(--kw-accent-inv)/85"
                          style={{ width: "82%" }}
                        />
                        <div className="absolute inset-0 flex items-center justify-between px-3.5 font-mono text-[11px] tabular-nums">
                          <span className="font-semibold text-(--kw-bg)">
                            YES 82¢
                          </span>
                          <span className="text-(--kw-bg)/65">NO 18¢</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-4">
                        <button
                          type="button"
                          className="py-2.5 px-2 border border-(--kw-bg)/20 hover:border-(--kw-bg)/45 transition-colors text-[12px] font-medium flex items-center justify-center gap-1.5"
                        >
                          Buy YES{" "}
                          <span className="font-mono tabular-nums text-(--kw-accent-inv)">
                            82¢
                          </span>
                        </button>
                        <button
                          type="button"
                          className="py-2.5 px-2 border border-(--kw-bg)/20 hover:border-(--kw-bg)/45 transition-colors text-[12px] font-medium flex items-center justify-center gap-1.5"
                        >
                          Buy NO{" "}
                          <span className="font-mono tabular-nums text-(--kw-danger-bright)">
                            18¢
                          </span>
                        </button>
                        <button
                          type="button"
                          className="py-2.5 px-2 border border-(--kw-bg)/20 hover:border-(--kw-bg)/45 transition-colors text-[12px] font-medium flex items-center justify-center gap-1"
                        >
                          Details <ArrowUpRight className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="mt-4 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.18em] text-(--kw-bg)/55">
                        <span>Resolves Mar 31, 2026</span>
                        <span className="hidden sm:inline">
                          Powered by Knoww
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COVERAGE — orbit map of the places where opinions form. The
          reference image is recreated in code so it can adapt to theme
          colors, text scaling and responsive breakpoints. */}
      <section
        id="coverage"
        className="border-b border-(--kw-fg)/10 bg-(--kw-bg-alt)"
      >
        <div className="mx-auto w-full max-w-[1280px] 2xl:max-w-[1440px] px-6 sm:px-8 py-20 md:py-28 lg:py-32">
          <div className="kw-reveal mb-6 flex items-baseline justify-between border-b border-(--kw-fg)/15 pb-5">
            <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              § IV. Coverage
            </h2>
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              P. 04 / 05
            </span>
          </div>

          <h3 className="kw-reveal mx-auto max-w-[700px] text-center text-[28px] font-semibold leading-[1.04] text-(--kw-fg) [font-family:var(--font-editorial),Georgia,serif] [letter-spacing:0] sm:text-[34px] md:text-[40px] lg:text-[44px]">
            Wherever the future{" "}
            <span className="italic text-(--kw-accent-text)">
              is discussed,
            </span>
            <br />
            Knoww is already there.
          </h3>

          <div className="kw-reveal relative mt-10 md:mt-12">
            {/* Desktop orbit map. */}
            <div className="relative mx-auto hidden h-[380px] max-w-[1120px] overflow-visible md:block lg:h-[420px] xl:h-[460px]">
              <div
                aria-hidden
                className="absolute left-1/2 top-[55%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-dashed border-(--kw-fg)/24"
                style={{ width: "96%", height: "86%" }}
              />
              <div
                aria-hidden
                className="absolute left-1/2 top-[55%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-dashed border-(--kw-fg)/24"
                style={{ width: "76%", height: "66%" }}
              />
              <div
                aria-hidden
                className="absolute left-1/2 top-[55%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-dashed border-(--kw-fg)/24"
                style={{ width: "52%", height: "42%" }}
              />

              <div
                aria-hidden
                className="absolute left-1/2 top-[55%] h-[210px] w-[430px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--kw-accent)/14 blur-3xl"
              />

              <div className="absolute left-1/2 top-[0%] -translate-x-1/2 font-mono text-[11px] uppercase tracking-[0.18em] text-(--kw-accent-text) whitespace-nowrap">
                <span className="text-(--kw-accent)">•</span>
                <span className="mx-4">Knowledge, Culture & Professional</span>
                <span className="text-(--kw-accent)">•</span>
              </div>
              <div className="absolute left-1/2 top-[17%] -translate-x-1/2 font-mono text-[11px] uppercase tracking-[0.18em] text-(--kw-accent-text) whitespace-nowrap">
                <span className="text-(--kw-accent)">•</span>
                <span className="mx-4">Media & Publications</span>
                <span className="text-(--kw-accent)">•</span>
              </div>
              <div className="absolute left-1/2 top-[42%] -translate-x-1/2 font-mono text-[11px] uppercase tracking-[0.18em] text-(--kw-accent-text) whitespace-nowrap">
                <span className="text-(--kw-accent)">•</span>
                <span className="mx-4">Discussion Platforms</span>
                <span className="text-(--kw-accent)">•</span>
              </div>

              {/* Outer pills */}
              {COVERAGE_PILLS.map((p) => (
                <div
                  key={p.name}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                >
                  <span className="inline-block rounded-full border border-(--kw-fg)/12 bg-(--kw-bg-card)/95 px-4 py-1.5 text-[12px] font-semibold text-(--kw-fg)/90 whitespace-nowrap shadow-[0_10px_28px_-20px_rgba(0,0,0,0.55),0_2px_10px_-8px_rgba(0,0,0,0.35)]">
                    {p.name}
                  </span>
                </div>
              ))}

              {/* Centre pill — Knoww */}
              <div className="absolute left-1/2 top-[55%] -translate-x-1/2 -translate-y-1/2">
                <span className="relative inline-flex items-center gap-3 rounded-full border-[3px] border-(--kw-accent) bg-(--kw-bg-card)/92 px-8 py-4 shadow-[0_0_0_16px_color-mix(in_srgb,var(--kw-accent)_9%,transparent),0_24px_60px_-24px_rgba(13,159,110,0.55)]">
                  <span className="w-8 h-8 bg-(--kw-fg) text-(--kw-bg) flex items-center justify-center rounded-[4px]">
                    <KnowwMark size="sm" />
                  </span>
                  <span className="font-bold text-[26px] tracking-tight">
                    Knoww
                  </span>
                </span>
              </div>
            </div>

            {/* Mobile fallback — flowing pill grid, no orbit crowding. */}
            <div className="md:hidden rounded-[28px] border border-(--kw-fg)/12 bg-(--kw-bg-card)/70 p-6 sm:p-8">
              <div className="flex justify-center mb-6">
                <span className="relative inline-flex items-center gap-2 px-5 py-2.5 rounded-full border-2 border-(--kw-accent) bg-(--kw-bg-card) shadow-[0_0_0_5px_color-mix(in_srgb,var(--kw-accent)_14%,transparent)]">
                  <span className="w-5 h-5 bg-(--kw-accent)/15 border border-(--kw-accent)/40 flex items-center justify-center rounded-[3px]">
                    <KnowwMark size="sm" />
                  </span>
                  <span className="font-bold text-[15px] tracking-tight">
                    Knoww
                  </span>
                </span>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {COVERAGE_PILLS.map((p) => (
                  <span
                    key={p.name}
                    className="inline-block px-3 py-1.5 rounded-full border border-(--kw-fg)/20 bg-(--kw-bg-card) text-[12px] font-mono text-(--kw-fg)/80"
                  >
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="kw-reveal mt-8 flex justify-center md:mt-0">
            <div className="flex items-center gap-3 text-center">
              <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-(--kw-accent)" />
              <span className="kw-editorial text-[15px] md:text-[17px] text-(--kw-fg)/70">
                And growing — every site where opinions live is a candidate for
                the layer.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section
        id="how"
        className="border-b border-(--kw-fg)/10 bg-(--kw-fg) text-(--kw-bg)"
      >
        <div className="w-full max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 py-20 md:py-28 lg:py-32">
          <div className="flex items-baseline justify-between border-b border-(--kw-bg)/15 pb-5 mb-8">
            <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-bg)/75">
              § V. Installation to position, in about a minute
            </h2>
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-bg)/70">
              P. 05 / 05
            </span>
          </div>

          <h3 className="kw-reveal text-4xl md:text-5xl font-bold tracking-[-0.035em] leading-[1] mb-8 max-w-[820px]">
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
                className={`kw-reveal py-6 px-6 ${i !== 2 ? "md:border-r border-(--kw-bg)/15" : ""} ${i !== 0 ? "border-t md:border-t-0 border-(--kw-bg)/15" : ""}`}
              >
                <div className="flex items-end justify-between mb-8">
                  <span
                    aria-hidden
                    className="kw-editorial italic text-[76px] md:text-[88px] leading-[0.75] tracking-[-0.04em] text-(--kw-bg)"
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

          <div className="mt-8 pt-6 border-t border-(--kw-bg)/15 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
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
        <div className="w-full max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 py-20 md:py-28 lg:py-32">
          <div className="max-w-[860px]">
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 mb-6 block">
              § VI — Install
            </span>
            <h2 className="text-[48px] sm:text-[64px] md:text-[80px] font-bold tracking-[-0.035em] leading-[0.94] mb-8">
              Start reading
              <br />
              the market,
              <br />
              <span className="italic kw-editorial">not around it.</span>
            </h2>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <a
                href={CHROME_STORE_URL}
                className="inline-flex items-center gap-2.5 bg-(--kw-fg) text-(--kw-bg) px-8 py-5 text-[15px] font-semibold hover:bg-(--kw-fg)/90 transition-colors group"
              >
                <Download className="w-4 h-4" />
                Install Knoww — Free
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
            <p className="text-[12px] text-(--kw-fg)/60 leading-[1.55] max-w-[220px]">
              A prediction market layer for the{" "}
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
          <div className="max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 py-4 flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/60">
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
      <div className="flex items-center h-11 min-w-0">
        <div className="shrink-0 px-5 h-full flex items-center border-r border-(--kw-bg)/15">
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-accent-inv) flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-(--kw-accent) animate-pulse" />
            Live
          </span>
        </div>
        <div className="flex-1 min-w-0 overflow-hidden relative kw-ticker-track">
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
