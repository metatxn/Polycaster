"use client";

import { useEffect, useState } from "react";
import {
  type MarketData,
  type Phase,
  renderBody,
  SealIcon,
  type TweetCopy,
} from "./tweet-overlay-hero";

export type RedditPost = {
  subreddit: string;
  subInitial: string;
  subColor: string;
  user: string;
  time: string;
  title: string;
  body: TweetCopy[];
  upvotes: string;
  comments: string;
  market: MarketData;
};

export const REDDIT_POSTS: RedditPost[] = [
  {
    subreddit: "r/MachineLearning",
    subInitial: "M",
    subColor: "linear-gradient(135deg, #10a37f, #1d9bf0)",
    user: "u/transformer_main",
    time: "2h",
    title: "GPT‑6 benchmarks leaked — Q4 ship target",
    body: [
      "Sources at OpenAI say the model is ",
      { hl: "tracking ahead of forecasts" },
      ".",
    ],
    upvotes: "12.4k",
    comments: "892",
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
    subreddit: "r/economics",
    subInitial: "$",
    subColor: "linear-gradient(135deg, #f59e0b, #b45309)",
    user: "u/macro_watcher",
    time: "4h",
    title: "Powell signals: hold rates through Q3?",
    body: [
      "Dot plot rearranged — ",
      { hl: "consensus is shifting to a hold" },
      ".",
    ],
    upvotes: "8.2k",
    comments: "1.4k",
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
    subreddit: "r/politics",
    subInitial: "P",
    subColor: "linear-gradient(135deg, #1d9bf0, #8b5cf6)",
    user: "u/early_caller",
    time: "6h",
    title: "2028: Vance and Newsom in dead heat",
    body: ["Polymarket has the race ", { hl: "tied at 20% / 17%" }, "."],
    upvotes: "5.8k",
    comments: "2.3k",
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
    subreddit: "r/CryptoCurrency",
    subInitial: "C",
    subColor: "linear-gradient(135deg, #f7931a, #b45309)",
    user: "u/satoshi_lite",
    time: "3h",
    title: "BTC back above $120K — is $150K EOY in play?",
    body: ["On-chain accumulation is ", { hl: "back to April highs" }, "."],
    upvotes: "9.7k",
    comments: "1.1k",
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
    subreddit: "r/nfl",
    subInitial: "N",
    subColor: "linear-gradient(135deg, #16a34a, #065f46)",
    user: "u/gridiron_guru",
    time: "5h",
    title: "Way-too-early Super Bowl LX odds dropped",
    body: ["Chiefs and Eagles ", { hl: "headline the futures board" }, "."],
    upvotes: "6.3k",
    comments: "3.1k",
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
    subreddit: "r/technology",
    subInitial: "T",
    subColor: "linear-gradient(135deg, #ef4444, #b91c1c)",
    user: "u/range_anxiety",
    time: "7h",
    title: "Tesla reaffirms 2026 robotaxi rollout",
    body: [
      "Wide launch promised next year — ",
      { hl: "Street stays doubtful" },
      ".",
    ],
    upvotes: "4.4k",
    comments: "2.8k",
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

const RD_ICONS = {
  upvote: (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M10 3l7 7h-4v7H7v-7H3l7-7z" />
    </svg>
  ),
  downvote: (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M10 17l-7-7h4V3h6v7h4l-7 7z" />
    </svg>
  ),
  comments: (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-3 3v-3H5a2 2 0 0 1-2-2V5z" />
    </svg>
  ),
  share: (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3" />
      <path d="M10 14V4M6 8l4-4 4 4" />
    </svg>
  ),
  save: (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M5 3h10v14l-5-3-5 3V3z" />
    </svg>
  ),
};

export function RedditItem({
  p,
  active,
  phase,
}: {
  p: RedditPost;
  active: boolean;
  phase: Phase;
}) {
  const [voted, setVoted] = useState<"up" | "down" | null>(null);
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!active) {
      setClosed(false);
      setFeedback(null);
    }
  }, [active]);

  return (
    <article className={`kwt-rd${active ? " kwt-rd-active" : ""}`}>
      {active && phase === 1 && <div className="kwt-scan-beam" />}

      <div className="kwt-rd-vote">
        <button
          type="button"
          className={`kwt-rd-vote-btn kwt-rd-up${voted === "up" ? " kwt-on" : ""}`}
          onClick={() => setVoted(voted === "up" ? null : "up")}
          aria-label="Upvote"
        >
          {RD_ICONS.upvote}
        </button>
        <span className="kwt-rd-score">{p.upvotes}</span>
        <button
          type="button"
          className={`kwt-rd-vote-btn kwt-rd-down${voted === "down" ? " kwt-on" : ""}`}
          onClick={() => setVoted(voted === "down" ? null : "down")}
          aria-label="Downvote"
        >
          {RD_ICONS.downvote}
        </button>
      </div>

      <div className="kwt-rd-body">
        <header className="kwt-rd-head">
          <div
            className="kwt-rd-sub-icon"
            style={{ background: p.subColor }}
            aria-hidden="true"
          >
            {p.subInitial}
          </div>
          <div className="kwt-rd-meta">
            <span className="kwt-rd-sub">{p.subreddit}</span>
            <span className="kwt-rd-dot">·</span>
            <span className="kwt-rd-user">Posted by {p.user}</span>
            <span className="kwt-rd-dot">·</span>
            <span className="kwt-rd-time">{p.time}</span>
          </div>
        </header>

        <h3 className="kwt-rd-title">{p.title}</h3>
        <p className="kwt-rd-text">
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

        <div className="kwt-rd-actions">
          <button type="button" className="kwt-rd-act">
            {RD_ICONS.comments}
            <span>{p.comments} Comments</span>
          </button>
          <button type="button" className="kwt-rd-act">
            {RD_ICONS.share}
            <span>Share</span>
          </button>
          <button
            type="button"
            className={`kwt-rd-act${saved ? " kwt-on" : ""}`}
            onClick={() => setSaved((s) => !s)}
          >
            {RD_ICONS.save}
            <span>{saved ? "Saved" : "Save"}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

export const RedditLogo = (
  <svg
    viewBox="0 0 20 20"
    width="13"
    height="13"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M10 0C4.477 0 0 4.477 0 10s4.477 10 10 10 10-4.477 10-10S15.523 0 10 0zm5.014 11.5c.027.165.04.331.04.499 0 2.55-2.97 4.62-6.628 4.62-3.66 0-6.629-2.07-6.629-4.62 0-.168.014-.334.04-.5a1.45 1.45 0 0 1 .61-2.776c.4 0 .76.16 1.024.418 1-.722 2.385-1.18 3.92-1.236l.747-3.527a.32.32 0 0 1 .376-.246l2.448.518a1.014 1.014 0 1 1-.041 1.029l-2.197-.464-.667 3.146c1.508.072 2.864.527 3.851 1.234a1.451 1.451 0 1 1 1.106 2.604zM7.07 11.5c-.39 0-.706-.317-.706-.708 0-.39.316-.708.706-.708.39 0 .706.317.706.708 0 .39-.317.708-.706.708zm5.86 0c-.39 0-.706-.317-.706-.708 0-.39.316-.708.706-.708.39 0 .706.317.706.708 0 .39-.317.708-.706.708zm-.347 1.96a.355.355 0 0 1 .476.515c-.602.6-1.557.892-2.917.892h-.286c-1.36 0-2.314-.292-2.916-.892a.355.355 0 0 1 .475-.515c.456.456 1.246.683 2.441.683h.286c1.196 0 1.985-.227 2.441-.683z" />
  </svg>
);
