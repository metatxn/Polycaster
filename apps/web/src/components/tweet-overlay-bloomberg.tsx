"use client";

import { useEffect, useState } from "react";
import {
  type MarketData,
  type Phase,
  renderBody,
  SealIcon,
  type TweetCopy,
} from "./tweet-overlay-hero";

export type BloombergArticle = {
  section: string;
  headline: string;
  lede: TweetCopy[];
  byline: string;
  time: string;
  ticker: { symbol: string; delta: string; dir: "up" | "down" };
  market: MarketData;
};

export const BLOOMBERG_ARTICLES: BloombergArticle[] = [
  {
    section: "TECHNOLOGY",
    headline: "OpenAI Eyes Q4 GPT‑6 Launch as Benchmarks Clear",
    lede: [
      "Sources say the model is ",
      { hl: "tracking ahead of internal forecasts" },
      ", with launch narrowing to Q4.",
    ],
    byline: "Shirin Ghaffary",
    time: "14m ago",
    ticker: { symbol: "NVDA", delta: "+0.84%", dir: "up" },
    market: {
      title: "Next OpenAI Flagship Model",
      icon: {
        type: "letter",
        letter: "AI",
        bg: "linear-gradient(135deg, #10a37f, #1d9bf0)",
      },
      cat: "TECH",
      match: 91,
      options: [
        { label: "GPT‑6", pct: 64, hue: "blue" },
        { label: "Sonnet 5", pct: 18, hue: "purple" },
      ],
      more: 6,
    },
  },
  {
    section: "ECONOMICS",
    headline: "Powell's Pivot Signals Fed Hold Through Q3",
    lede: [
      "The dot plot rearranges around ",
      { hl: "a hold through September" },
      " as core inflation stays sticky.",
    ],
    byline: "Saleha Mohsin",
    time: "32m ago",
    ticker: { symbol: "UST10Y", delta: "−4 bps", dir: "down" },
    market: {
      title: "Fed Rate Decision · September FOMC",
      icon: {
        type: "letter",
        letter: "$",
        bg: "linear-gradient(135deg, #f59e0b, #b45309)",
      },
      cat: "MACRO",
      match: 94,
      options: [
        { label: "Hold", pct: 72, hue: "blue" },
        { label: "Cut 25 bps", pct: 21, hue: "purple" },
      ],
      more: 3,
    },
  },
  {
    section: "POLITICS",
    headline: "Vance, Newsom Tighten 2028 Field",
    lede: [
      "The two leading candidates now sit ",
      { hl: "within margin at 20% / 17%" },
      ", a notable tightening.",
    ],
    byline: "Mario Parker",
    time: "1h ago",
    ticker: { symbol: "PRES28", delta: "+1.2 vol", dir: "up" },
    market: {
      title: "Presidential Election Winner 2028",
      icon: { type: "seal" },
      cat: "ELECTIONS",
      match: 65,
      options: [
        { label: "JD Vance", pct: 20, hue: "blue" },
        { label: "Gavin Newsom", pct: 17, hue: "purple" },
      ],
      more: 34,
    },
  },
  {
    section: "MARKETS",
    headline: "Bitcoin Rebounds Past $120K as Year-End Targets Firm",
    lede: [
      "On-chain demand has returned, putting ",
      { hl: "$150K back within reach" },
      " by December.",
    ],
    byline: "Olga Kharif",
    time: "21m ago",
    ticker: { symbol: "BTC", delta: "+3.4%", dir: "up" },
    market: {
      title: "Bitcoin above $150K by Dec 31",
      icon: {
        type: "letter",
        letter: "₿",
        bg: "linear-gradient(135deg, #f7931a, #b45309)",
      },
      cat: "CRYPTO",
      match: 88,
      options: [
        { label: "Above", pct: 31, hue: "blue" },
        { label: "Below", pct: 69, hue: "purple" },
      ],
      more: 4,
    },
  },
  {
    section: "BUSINESS OF SPORTS",
    headline: "Chiefs Lead Early Super Bowl LX Futures",
    lede: [
      "Sportsbooks open with Kansas City ahead, ",
      { hl: "Philadelphia a close second" },
      ".",
    ],
    byline: "Randall Williams",
    time: "44m ago",
    ticker: { symbol: "SBLX", delta: "+0.6 vol", dir: "up" },
    market: {
      title: "Super Bowl LX Champion",
      icon: {
        type: "letter",
        letter: "SB",
        bg: "linear-gradient(135deg, #16a34a, #065f46)",
      },
      cat: "SPORTS",
      match: 79,
      options: [
        { label: "Chiefs", pct: 27, hue: "blue" },
        { label: "Eagles", pct: 15, hue: "purple" },
      ],
      more: 12,
    },
  },
  {
    section: "TECHNOLOGY",
    headline: "Tesla Reaffirms 2026 Robotaxi Timeline; Street Doubts Linger",
    lede: [
      "Executives promised a wide rollout next year, but ",
      { hl: "analysts remain skeptical" },
      ".",
    ],
    byline: "Dana Hull",
    time: "1h ago",
    ticker: { symbol: "TSLA", delta: "−1.1%", dir: "down" },
    market: {
      title: "Tesla Robotaxi launches in 2026",
      icon: {
        type: "letter",
        letter: "T",
        bg: "linear-gradient(135deg, #ef4444, #b91c1c)",
      },
      cat: "TECH",
      match: 73,
      options: [
        { label: "Yes", pct: 38, hue: "blue" },
        { label: "No", pct: 62, hue: "purple" },
      ],
      more: 5,
    },
  },
];

export function BloombergItem({
  a,
  active,
  phase,
}: {
  a: BloombergArticle;
  active: boolean;
  phase: Phase;
}) {
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!active) {
      setClosed(false);
      setFeedback(null);
    }
  }, [active]);

  return (
    <article className={`kwt-bb${active ? " kwt-bb-active" : ""}`}>
      {active && phase === 1 && <div className="kwt-scan-beam" />}

      <header className="kwt-bb-strip">
        <span className="kwt-bb-mark">BLOOMBERG</span>
        <span className="kwt-bb-strip-dot" aria-hidden="true" />
        <span className="kwt-bb-section">{a.section}</span>
      </header>

      <h3 className="kwt-bb-headline">{a.headline}</h3>

      <p className="kwt-bb-lede">{renderBody(a.lede, active && phase >= 1)}</p>

      {!closed && (
        <div className={`kwt-pm-card${active && phase === 2 ? " kwt-in" : ""}`}>
          <div className="kwt-pm-head">
            <div className="kwt-pm-icon">
              {a.market.icon.type === "seal" ? (
                <SealIcon />
              ) : (
                <div
                  className="kwt-pm-icon-letter"
                  style={{ background: a.market.icon.bg }}
                >
                  {a.market.icon.letter}
                </div>
              )}
            </div>
            <div className="kwt-pm-title-wrap">
              <div className="kwt-pm-title">{a.market.title}</div>
              <div className="kwt-pm-meta">
                <span className="kwt-pm-match">{a.market.match}% MATCH</span>
                <span className="kwt-pm-meta-dot">·</span>
                <span className="kwt-pm-cat">{a.market.cat}</span>
              </div>
            </div>
            <div className="kwt-pm-head-actions">
              <button
                type="button"
                className="kwt-pm-icon-btn"
                aria-label="Collapse"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <button
                type="button"
                className="kwt-pm-icon-btn"
                aria-label="Close"
                onClick={() => setClosed(true)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="6" />
                </svg>
              </button>
            </div>
          </div>
          <div className="kwt-pm-options">
            {a.market.options.map((opt, i) => (
              <button
                type="button"
                key={i}
                className={`kwt-pm-opt kwt-pm-${opt.hue}`}
              >
                <span
                  className="kwt-pm-opt-bar"
                  style={{ width: `${opt.pct * 1.4}%` }}
                />
                <span className="kwt-pm-opt-label">{opt.label}</span>
                <span className="kwt-pm-opt-pct">{opt.pct}%</span>
              </button>
            ))}
          </div>
          <button type="button" className="kwt-pm-more">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{a.market.more} more options</span>
          </button>
          <div className="kwt-pm-divider" />
          <div className="kwt-pm-foot">
            <div className="kwt-pm-source">
              <span className="kwt-pm-source-mark">P</span>
              <span className="kwt-pm-source-label">POLYMARKET</span>
            </div>
            <div className="kwt-pm-foot-right">
              <div className="kwt-pm-feedback">
                <button
                  type="button"
                  className={`kwt-pm-fb kwt-pm-fb-good${feedback === "good" ? " kwt-on" : ""}`}
                  onClick={() =>
                    setFeedback(feedback === "good" ? null : "good")
                  }
                >
                  Good
                </button>
                <button
                  type="button"
                  className={`kwt-pm-fb kwt-pm-fb-bad${feedback === "bad" ? " kwt-on" : ""}`}
                  onClick={() => setFeedback(feedback === "bad" ? null : "bad")}
                >
                  Bad
                </button>
              </div>
              <button type="button" className="kwt-pm-view">
                <span>VIEW MARKET</span>
                <span className="kwt-pm-view-arr">↗</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="kwt-bb-foot">
        <span className="kwt-bb-by">By {a.byline}</span>
        <span className="kwt-bb-foot-dot" aria-hidden="true">
          ·
        </span>
        <span className="kwt-bb-time">{a.time}</span>
        <span className={`kwt-bb-tick kwt-bb-tick-${a.ticker.dir}`}>
          <span className="kwt-bb-tick-arr" aria-hidden="true">
            {a.ticker.dir === "up" ? "▲" : "▼"}
          </span>
          <span className="kwt-bb-tick-sym">{a.ticker.symbol}</span>
          <span className="kwt-bb-tick-delta">{a.ticker.delta}</span>
        </span>
      </footer>
    </article>
  );
}

export const BloombergLogo = (
  <svg
    viewBox="0 0 24 24"
    width="11"
    height="11"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M3.5 4h7.2c2.7 0 4.4 1.3 4.4 3.4 0 1.5-.9 2.5-2.2 2.9 1.6.4 2.7 1.5 2.7 3.3 0 2.4-2 4-4.7 4H3.5V4zm6.6 5.4c1.2 0 1.9-.5 1.9-1.5s-.7-1.5-1.9-1.5H6.7v3h3.4zm.4 5.4c1.2 0 2-.6 2-1.7 0-1.2-.8-1.7-2-1.7H6.7v3.4h3.8zM17.5 4h2.9v6.6h.1c.6-1 1.7-1.7 3.2-1.7v3c-2 0-3.2.9-3.2 3v6.5h-3V4z" />
  </svg>
);
