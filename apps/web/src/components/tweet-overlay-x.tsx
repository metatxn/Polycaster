"use client";

import { useEffect, useState } from "react";
import {
  type MarketData,
  type Phase,
  renderBody,
  SealIcon,
  type TweetCopy,
} from "./tweet-overlay-hero";

export type Tweet = {
  name: string;
  handle: string;
  verified: boolean;
  time: string;
  initials: string;
  avatar: string;
  body: TweetCopy[];
  stats: { reply: string; retweet: string; like: string; views: string };
  market: MarketData;
};

export const TWEETS: Tweet[] = [
  {
    name: "Sam Altman",
    handle: "sama",
    verified: true,
    time: "14m",
    initials: "SA",
    avatar: "linear-gradient(135deg, #00ba7c, #1d9bf0)",
    body: [
      "gpt‑6 is going to ship sooner than people think.",
      " the next year is going to be ",
      { hl: "wild" },
      ".",
    ],
    stats: { reply: "2.1K", retweet: "8K", like: "41.2K", views: "2.4M" },
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
    name: "Bloomberg",
    handle: "business",
    verified: true,
    time: "32m",
    initials: "BB",
    avatar: "linear-gradient(135deg, #f59e0b, #ef4444)",
    body: [
      "BREAKING: Powell signals the Fed may ",
      { hl: "hold rates through Q3" },
      " amid sticky inflation data.",
    ],
    stats: { reply: "892", retweet: "3.4K", like: "12.1K", views: "1.1M" },
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
    name: "Polymarket",
    handle: "Polymarket",
    verified: true,
    time: "1h",
    initials: "PM",
    avatar: "linear-gradient(135deg, #1d9bf0, #8b5cf6)",
    body: [
      "Recession odds for 2026 just ",
      { hl: "spiked to 71%" },
      " on the back of yesterday's CPI print.",
    ],
    stats: { reply: "412", retweet: "1.2K", like: "5.8K", views: "643K" },
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
];

function VerifiedIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Verified"
      style={{ flexShrink: 0 }}
    >
      <title>Verified</title>
      <path
        fill="#1d9bf0"
        d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"
      />
    </svg>
  );
}

const X_ICONS = {
  reply: (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" />
    </svg>
  ),
  retweet: (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" />
    </svg>
  ),
  like: (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z" />
    </svg>
  ),
  views: (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z" />
    </svg>
  ),
  share: (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" />
    </svg>
  ),
  bookmark: (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z" />
    </svg>
  ),
  more: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  ),
};

export function TweetItem({
  t,
  active,
  phase,
}: {
  t: Tweet;
  active: boolean;
  phase: Phase;
}) {
  const [liked, setLiked] = useState(false);
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!active) {
      setClosed(false);
      setFeedback(null);
    }
  }, [active]);

  return (
    <article className={`kwt-tweet${active ? " kwt-tweet-active" : ""}`}>
      {active && phase === 1 && <div className="kwt-scan-beam" />}

      <div className="kwt-avatar">
        <div className="kwt-avatar-img" style={{ background: t.avatar }}>
          <span>{t.initials}</span>
        </div>
      </div>
      <div className="kwt-body">
        <div className="kwt-head">
          <div className="kwt-names">
            <span className="kwt-name">{t.name}</span>
            {t.verified && <VerifiedIcon size={16} />}
            <span className="kwt-handle">@{t.handle}</span>
            <span className="kwt-sep">·</span>
            <span className="kwt-time">{t.time}</span>
          </div>
          <button type="button" className="kwt-more-btn" aria-label="More">
            {X_ICONS.more}
          </button>
        </div>

        <p className="kwt-text">{renderBody(t.body, active && phase >= 1)}</p>

        {active && !closed && (
          <div className={`kwt-pm-card${phase === 2 ? " kwt-in" : ""}`}>
            <div className="kwt-pm-head">
              <div className="kwt-pm-icon">
                {t.market.icon.type === "seal" ? (
                  <SealIcon />
                ) : (
                  <div
                    className="kwt-pm-icon-letter"
                    style={{ background: t.market.icon.bg }}
                  >
                    {t.market.icon.letter}
                  </div>
                )}
              </div>
              <div className="kwt-pm-title-wrap">
                <div className="kwt-pm-title">{t.market.title}</div>
                <div className="kwt-pm-meta">
                  <span className="kwt-pm-match">{t.market.match}% MATCH</span>
                  <span className="kwt-pm-meta-dot">·</span>
                  <span className="kwt-pm-cat">{t.market.cat}</span>
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
              {t.market.options.map((opt, i) => (
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
              <span>{t.market.more} more options</span>
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

        <div className="kwt-actions">
          <button type="button" className="kwt-act kwt-act-reply">
            {X_ICONS.reply}
            <span>{t.stats.reply}</span>
          </button>
          <button type="button" className="kwt-act kwt-act-retweet">
            {X_ICONS.retweet}
            <span>{t.stats.retweet}</span>
          </button>
          <button
            type="button"
            className={`kwt-act kwt-act-like${liked ? " kwt-on" : ""}`}
            onClick={() => setLiked((l) => !l)}
          >
            {X_ICONS.like}
            <span>{t.stats.like}</span>
          </button>
          <button type="button" className="kwt-act kwt-act-views">
            {X_ICONS.views}
            <span>{t.stats.views}</span>
          </button>
          <div className="kwt-act-end">
            <button
              type="button"
              className="kwt-act kwt-act-mini"
              aria-label="Bookmark"
            >
              {X_ICONS.bookmark}
            </button>
            <button
              type="button"
              className="kwt-act kwt-act-mini"
              aria-label="Share"
            >
              {X_ICONS.share}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export const XLogo = (
  <svg
    viewBox="0 0 24 24"
    width="11"
    height="11"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);
