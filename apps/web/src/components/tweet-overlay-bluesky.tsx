"use client";

import { useEffect, useState } from "react";
import {
  type MarketData,
  type Phase,
  renderBody,
  SealIcon,
  type TweetCopy,
} from "./tweet-overlay-hero";

export type BlueskyPost = {
  name: string;
  handle: string;
  time: string;
  initials: string;
  avatar: string;
  body: TweetCopy[];
  stats: { reply: string; repost: string; like: string };
  market: MarketData;
};

export const BLUESKY_POSTS: BlueskyPost[] = [
  {
    name: "Andrej Karpathy",
    handle: "karpathy.bsky.social",
    time: "18m",
    initials: "AK",
    avatar: "linear-gradient(135deg, #1185fe, #6366f1)",
    body: [
      "GPT-6 internal benchmarks suggesting ",
      { hl: "scaling laws still hold" },
      ". Q4 ship looking real.",
    ],
    stats: { reply: "412", repost: "1.8K", like: "8.4K" },
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
    name: "Paul Krugman",
    handle: "krugman.bsky.social",
    time: "1h",
    initials: "PK",
    avatar: "linear-gradient(135deg, #f59e0b, #ef4444)",
    body: [
      "Powell's testimony today — ",
      { hl: "the dots are shifting toward a hold" },
      " through Q3.",
    ],
    stats: { reply: "284", repost: "920", like: "3.1K" },
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
    name: "Nate Silver",
    handle: "natesilver.bsky.social",
    time: "3h",
    initials: "NS",
    avatar: "linear-gradient(135deg, #1d9bf0, #8b5cf6)",
    body: [
      "2028 numbers tightening — ",
      { hl: "Vance and Newsom are within margin" },
      ".",
    ],
    stats: { reply: "612", repost: "1.4K", like: "5.2K" },
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
    name: "Glassnode",
    handle: "glassnode.bsky.social",
    time: "26m",
    initials: "GN",
    avatar: "linear-gradient(135deg, #f7931a, #1d9bf0)",
    body: [
      "BTC back over $120K — ",
      { hl: "$150K by year-end is live again" },
      ".",
    ],
    stats: { reply: "318", repost: "1.2K", like: "6.7K" },
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
    name: "Adam Schefter",
    handle: "schefter.bsky.social",
    time: "50m",
    initials: "AS",
    avatar: "linear-gradient(135deg, #c8102e, #7a0c1f)",
    body: [
      "Early Super Bowl LX futures — ",
      { hl: "Chiefs out front, Eagles close" },
      ".",
    ],
    stats: { reply: "540", repost: "1.6K", like: "9.3K" },
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
    name: "Sawyer Merritt",
    handle: "sawyermerritt.bsky.social",
    time: "2h",
    initials: "SM",
    avatar: "linear-gradient(135deg, #ef4444, #6366f1)",
    body: [
      "Tesla reaffirms robotaxi goes wide in 2026. ",
      { hl: "Markets skeptical" },
      ".",
    ],
    stats: { reply: "276", repost: "740", like: "4.0K" },
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

const BS_ICONS = {
  reply: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  repost: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  like: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  more: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  ),
};

export function BlueskyItem({
  p,
  active,
  phase,
}: {
  p: BlueskyPost;
  active: boolean;
  phase: Phase;
}) {
  const [liked, setLiked] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!active) {
      setClosed(false);
      setFeedback(null);
    }
  }, [active]);

  return (
    <article className={`kwt-bs${active ? " kwt-bs-active" : ""}`}>
      {active && phase === 1 && <div className="kwt-scan-beam" />}

      <div className="kwt-bs-avatar">
        <div className="kwt-bs-avatar-img" style={{ background: p.avatar }}>
          <span>{p.initials}</span>
        </div>
      </div>
      <div className="kwt-bs-body">
        <div className="kwt-bs-head">
          <div className="kwt-bs-names">
            <span className="kwt-bs-name">{p.name}</span>
            <span className="kwt-bs-handle">@{p.handle}</span>
            <span className="kwt-bs-sep">·</span>
            <span className="kwt-bs-time">{p.time}</span>
          </div>
          <button type="button" className="kwt-bs-more-btn" aria-label="More">
            {BS_ICONS.more}
          </button>
        </div>

        <p className="kwt-bs-text">
          {renderBody(p.body, active && phase >= 1)}
        </p>

        {!closed && (
          <div
            className={`kwt-pm-card${active && phase === 2 ? " kwt-in" : ""}`}
          >
            <div className="kwt-pm-head">
              <div className="kwt-pm-icon">
                {p.market.icon.type === "seal" ? (
                  <SealIcon />
                ) : (
                  <div
                    className="kwt-pm-icon-letter"
                    style={{ background: p.market.icon.bg }}
                  >
                    {p.market.icon.letter}
                  </div>
                )}
              </div>
              <div className="kwt-pm-title-wrap">
                <div className="kwt-pm-title">{p.market.title}</div>
                <div className="kwt-pm-meta">
                  <span className="kwt-pm-match">{p.market.match}% MATCH</span>
                  <span className="kwt-pm-meta-dot">·</span>
                  <span className="kwt-pm-cat">{p.market.cat}</span>
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
              {p.market.options.map((opt, i) => (
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
              <span>{p.market.more} more options</span>
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
                    onClick={() =>
                      setFeedback(feedback === "bad" ? null : "bad")
                    }
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

        <div className="kwt-bs-actions">
          <button type="button" className="kwt-bs-act kwt-bs-act-reply">
            {BS_ICONS.reply}
            <span>{p.stats.reply}</span>
          </button>
          <button
            type="button"
            className={`kwt-bs-act kwt-bs-act-repost${reposted ? " kwt-on" : ""}`}
            onClick={() => setReposted((r) => !r)}
          >
            {BS_ICONS.repost}
            <span>{p.stats.repost}</span>
          </button>
          <button
            type="button"
            className={`kwt-bs-act kwt-bs-act-like${liked ? " kwt-on" : ""}`}
            onClick={() => setLiked((l) => !l)}
          >
            {BS_ICONS.like}
            <span>{p.stats.like}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

export const BlueskyLogo = (
  <svg
    viewBox="0 0 64 64"
    width="13"
    height="13"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M13.873 3.805C21.21 9.332 29.103 20.537 32 26.55v15.882c0-.338-.13.044-.41.867-1.512 4.456-7.418 21.847-20.923 7.944-7.111-7.32-3.819-14.64 9.125-16.85-7.405 1.264-15.73-.825-18.014-9.015C1.12 23.022 0 8.51 0 6.55 0-3.268 8.579-.182 13.873 3.805zM50.127 3.805C42.79 9.332 34.897 20.537 32 26.55v15.882c0-.338.13.044.41.867 1.512 4.456 7.418 21.847 20.923 7.944 7.111-7.32 3.819-14.64-9.125-16.85 7.405 1.264 15.73-.825 18.014-9.015C62.88 23.022 64 8.51 64 6.55c0-9.818-8.578-6.732-13.873-2.745z" />
  </svg>
);
