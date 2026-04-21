"use client";

import { ArrowUpRight, Download, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/knoww-prediction-markets/naoaonihikedoiemhbolbnolibpmojgf";
const THEME_STORAGE_KEY = "knoww-landing-theme";
type Theme = "light" | "dark";

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

const MARKET_PREVIEW = [
  {
    q: "Will Bitcoin close above $120K in 2025?",
    yes: "68",
    no: "32",
    vol: "2.4M",
  },
  { q: "Will the Fed cut rates in Q1 2026?", yes: "82", no: "18", vol: "890K" },
  {
    q: "Will SpaceX launch Starship to Mars by 2028?",
    yes: "14",
    no: "86",
    vol: "412K",
  },
];

export default function LandingPage() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
      if (saved === "dark" || saved === "light") {
        setTheme(saved);
        return;
      }
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        setTheme("dark");
      }
    } catch {}
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {}
      return next;
    });
  };

  return (
    <div
      className="kw-landing fixed inset-0 z-50 overflow-y-auto bg-(--kw-bg) text-(--kw-fg) font-sans"
      data-theme={theme}
      style={{ colorScheme: theme }}
    >
      <ThemeVars />
      <TickerBar />

      <header className="border-b border-(--kw-fg)/10 bg-(--kw-bg)">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-(--kw-fg) flex items-center justify-center">
                <span className="text-(--kw-bg) font-bold text-sm leading-none">
                  K
                </span>
              </div>
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
            <button
              type="button"
              aria-label={
                theme === "light"
                  ? "Switch to dark theme"
                  : "Switch to light theme"
              }
              onClick={toggleTheme}
              className="w-9 h-9 flex items-center justify-center border border-(--kw-fg)/15 hover:border-(--kw-fg)/40 hover:bg-(--kw-fg)/5 transition-colors"
            >
              {theme === "light" ? (
                <Moon className="w-3.5 h-3.5" />
              ) : (
                <Sun className="w-3.5 h-3.5" />
              )}
            </button>
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
      <section className="border-b border-(--kw-fg)/10">
        <div className="max-w-[1200px] mx-auto px-6 py-20 md:py-28 grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-(--kw-fg)/60 mb-8">
              <span className="w-1.5 h-1.5 bg-(--kw-accent) animate-pulse" />
              Issue № 01 — The Prediction Layer
            </div>

            <h1 className="font-bold tracking-[-0.035em] leading-[0.92] text-[56px] sm:text-[80px] md:text-[96px] lg:text-[104px] mb-8">
              Every opinion,
              <br />a{" "}
              <span
                className="italic font-serif"
                style={{ fontFamily: "'Times New Roman', Georgia, serif" }}
              >
                position
              </span>
              .
            </h1>

            <p className="text-lg text-(--kw-fg)/70 max-w-[540px] leading-[1.55] mb-10">
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

          {/* TERMINAL MOCK */}
          <div className="lg:col-span-5 lg:pl-6">
            <div className="border border-(--kw-fg)/15 bg-(--kw-bg-card) shadow-[0_24px_60px_-30px_rgba(0,0,0,0.25)]">
              <div className="px-4 py-2.5 border-b border-(--kw-fg)/10 flex items-center justify-between bg-(--kw-fg)/2">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-(--kw-accent) animate-pulse" />
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
                    Knoww — Live Readout
                  </span>
                </div>
                <span className="text-[10px] font-mono text-(--kw-fg)/60">
                  21:04:31
                </span>
              </div>

              <div className="divide-y divide-(--kw-fg)/10">
                <div className="px-4 py-2.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.12em] text-(--kw-fg)/60">
                  <span>Market</span>
                  <span className="flex gap-6">
                    <span>YES</span>
                    <span>NO</span>
                    <span>VOL</span>
                  </span>
                </div>
                {MARKET_PREVIEW.map((m) => (
                  <div
                    key={m.q}
                    className="px-4 py-3.5 grid grid-cols-[1fr_auto] gap-4 hover:bg-(--kw-fg)/2 transition-colors"
                  >
                    <p className="text-[12px] leading-[1.4] text-(--kw-fg)/85">
                      {m.q}
                    </p>
                    <div className="flex items-center gap-4 font-mono text-[12px] tabular-nums">
                      <span className="text-(--kw-accent-text) font-semibold w-8 text-right">
                        {m.yes}¢
                      </span>
                      <span className="text-(--kw-danger-text) w-8 text-right">
                        {m.no}¢
                      </span>
                      <span className="text-(--kw-fg)/60 w-10 text-right">
                        {m.vol}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-4 py-3 border-t border-(--kw-fg)/10 bg-(--kw-fg)/2 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/60">
                  3 matched · live
                </span>
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)">
                  Trade
                  <ArrowUpRight className="w-3 h-3" />
                </div>
              </div>
            </div>

            <div className="mt-6 pl-6 border-l-2 border-(--kw-accent)">
              <p className="text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/60 mb-1">
                Note
              </p>
              <p className="text-[13px] text-(--kw-fg)/70 leading-[1.55]">
                Every number here is a real position you can take. Knoww
                surfaces them at the exact moment you&apos;d want to trade.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* BY THE NUMBERS (PROBLEM) */}
      <section className="border-b border-(--kw-fg)/10 bg-(--kw-bg-alt)">
        <div className="max-w-[1200px] mx-auto px-6 py-20">
          <div className="flex items-baseline justify-between border-b border-(--kw-fg)/15 pb-5 mb-12">
            <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              § I. The gap we&apos;re closing
            </h2>
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              P. 01 / 03
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-(--kw-fg)/15">
            {[
              {
                value: "4.9",
                unit: "BILLION",
                desc: "people post, argue, and predict online every day — each one an unrealized market position.",
              },
              {
                value: "0.1",
                unit: "PERCENT",
                desc: "of those opinions ever reach a prediction market. The signal-to-action gap is the product.",
              },
              {
                value: "50",
                unit: "BILLION $",
                desc: "total prediction market opportunity by 2030, per industry forecasts.",
              },
            ].map((s, i) => (
              <div
                key={s.unit}
                className={`py-10 px-6 ${i !== 2 ? "md:border-r border-(--kw-fg)/15" : ""} ${i !== 0 ? "border-t md:border-t-0 border-(--kw-fg)/15" : ""}`}
              >
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="font-bold text-7xl md:text-8xl tabular-nums tracking-[-0.04em] leading-none">
                    {s.value}
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/60">
                    {s.unit}
                  </span>
                </div>
                <p className="text-[14px] leading-[1.55] text-(--kw-fg)/65 max-w-[280px]">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* THESIS / SOLUTION */}
      <section id="thesis" className="border-b border-(--kw-fg)/10">
        <div className="max-w-[1200px] mx-auto px-6 py-24">
          <div className="flex items-baseline justify-between border-b border-(--kw-fg)/15 pb-5 mb-14">
            <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              § II. The thesis
            </h2>
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
              P. 02 / 03
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 mb-20">
            <div className="lg:col-span-5">
              <h3 className="text-4xl md:text-5xl font-bold tracking-[-0.03em] leading-[1.02]">
                Predictions live where conversations happen —
                <span className="text-(--kw-fg)/60">
                  {" "}
                  not where markets are.
                </span>
              </h3>
            </div>
            <div className="lg:col-span-6 lg:col-start-7 text-[15px] leading-[1.65] text-(--kw-fg)/70 space-y-4">
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
                className={`py-10 px-6 ${i !== 2 ? "md:border-r border-(--kw-fg)/15" : ""} ${i !== 0 ? "border-t md:border-t-0 border-(--kw-fg)/15" : ""}`}
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

          <h3 className="text-5xl md:text-6xl font-bold tracking-[-0.035em] leading-[0.98] mb-16 max-w-[900px]">
            Three steps. No account. No onboarding. No spectator sport.
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
            {[
              {
                n: "01",
                time: "~30s",
                title: "Install",
                desc: "Add Knoww from the Chrome Web Store. One permission prompt, one click.",
              },
              {
                n: "02",
                time: "Passive",
                title: "Browse",
                desc: "Keep doing what you were doing. A small indicator appears when a market is near.",
              },
              {
                n: "03",
                time: "~5s",
                title: "Trade",
                desc: "Open the panel, pick a side, confirm. Your position is live on-chain.",
              },
            ].map((s, i) => (
              <div
                key={s.n}
                className={`py-8 px-6 ${i !== 2 ? "md:border-r border-(--kw-bg)/15" : ""} ${i !== 0 ? "border-t md:border-t-0 border-(--kw-bg)/15" : ""}`}
              >
                <div className="flex items-center justify-between mb-10">
                  <span className="font-mono font-bold text-[64px] leading-none text-(--kw-bg)">
                    {s.n}
                  </span>
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
              className="inline-flex items-center gap-2.5 bg-(--kw-bg) text-(--kw-fg) px-6 py-3.5 text-[14px] font-semibold hover:bg-white transition-colors group w-fit"
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
              Colophon
            </span>
            <h2 className="text-[56px] sm:text-[80px] md:text-[96px] font-bold tracking-[-0.035em] leading-[0.92] mb-10">
              Start reading
              <br />
              the market,
              <br />
              <span
                className="italic font-serif"
                style={{ fontFamily: "'Times New Roman', Georgia, serif" }}
              >
                not around it
              </span>
              .
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
              <p className="text-[12px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/60">
                Chrome Web Store · 30 sec install · Free forever
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-(--kw-fg)/10 bg-(--kw-bg-alt)">
        <div className="max-w-[1200px] mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-[13px]">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 bg-(--kw-fg) flex items-center justify-center">
                <span className="text-(--kw-bg) font-bold text-xs leading-none">
                  K
                </span>
              </div>
              <span className="font-bold text-[14px]">Knoww</span>
            </div>
            <p className="text-[12px] text-(--kw-fg)/60 leading-[1.55] max-w-[220px]">
              A prediction market layer for the open internet.
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
      <div className="flex items-center h-9">
        <div className="shrink-0 px-4 h-full flex items-center border-r border-(--kw-bg)/15">
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-accent-inv) flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-(--kw-accent) animate-pulse" />
            Live
          </span>
        </div>
        <div className="flex-1 overflow-hidden relative">
          <div className="flex gap-10 animate-[ticker_60s_linear_infinite] whitespace-nowrap">
            {items.map((t, i) => (
              <span
                key={`${t.label}-${i}`}
                className="text-[11px] font-mono flex items-center gap-2 py-2"
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

function ThemeVars() {
  return (
    <style>{`
      .kw-landing {
        --kw-bg: #f6f4ee;
        --kw-bg-alt: #eeebe1;
        --kw-bg-card: #fbfaf5;
        --kw-fg: #0a0a0a;
        --kw-accent: #0d9f6e;
        --kw-accent-inv: #0d9f6e;
        --kw-accent-text: #047857;
        --kw-danger-text: #b91c1c;
        --kw-danger-bright: #f87171;
      }
      .kw-landing[data-theme="dark"] {
        --kw-bg: #0c0a07;
        --kw-bg-alt: #15120d;
        --kw-bg-card: #19150f;
        --kw-fg: #f0ebe0;
        --kw-accent: #10b981;
        --kw-accent-inv: #047857;
        --kw-accent-text: #34d399;
        --kw-danger-text: #fca5a5;
        --kw-danger-bright: #f87171;
      }
      @keyframes ticker {
        0% { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
      @media (prefers-reduced-motion: reduce) {
        .animate-\\[ticker_60s_linear_infinite\\] {
          animation: none !important;
        }
      }
    `}</style>
  );
}
