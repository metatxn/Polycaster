"use client";

import { useEffect, useRef, useState } from "react";
import {
  BLOOMBERG_ARTICLES,
  BloombergItem,
  BloombergLogo,
} from "./tweet-overlay-bloomberg";
import {
  BLUESKY_POSTS,
  BlueskyItem,
  BlueskyLogo,
} from "./tweet-overlay-bluesky";
import { REDDIT_POSTS, RedditItem, RedditLogo } from "./tweet-overlay-reddit";
import { TWEETS, TweetItem, XLogo } from "./tweet-overlay-x";

export type TweetCopy = string | { hl: string };

export type MarketData = {
  title: string;
  icon: { type: "letter"; letter: string; bg: string } | { type: "seal" };
  cat: string;
  match: number;
  options: Array<{ label: string; pct: number; hue: "blue" | "purple" }>;
  more: number;
};

export type Phase = 0 | 1 | 2;

export function SealIcon() {
  return (
    <div className="kwt-pm-seal">
      <svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true">
        <defs>
          <radialGradient id="kwtSealG" cx="50%" cy="35%" r="60%">
            <stop offset="0%" stopColor="#d4b06a" />
            <stop offset="100%" stopColor="#7a5a2a" />
          </radialGradient>
        </defs>
        <circle
          cx="20"
          cy="20"
          r="19"
          fill="#1a1410"
          stroke="url(#kwtSealG)"
          strokeWidth="1.5"
        />
        <circle
          cx="20"
          cy="20"
          r="14"
          fill="none"
          stroke="url(#kwtSealG)"
          strokeWidth="0.6"
          opacity="0.6"
        />
        <path
          d="M20 8 L23 14 L20 20 L17 14 Z"
          fill="url(#kwtSealG)"
          opacity="0.85"
        />
        <path
          d="M14 22 L26 22 L24 28 L16 28 Z"
          fill="url(#kwtSealG)"
          opacity="0.7"
        />
        <circle cx="20" cy="20" r="2" fill="#d4b06a" />
      </svg>
    </div>
  );
}

export function renderBody(parts: TweetCopy[], hlOn: boolean) {
  return parts.map((p, i) => {
    if (typeof p === "string") return <span key={i}>{p}</span>;
    return (
      <span key={i} className={`kwt-hl${hlOn ? " on" : ""}`}>
        {p.hl}
      </span>
    );
  });
}

type Platform = "x" | "reddit" | "bluesky" | "bloomberg";

// 3-post feed only on full-desktop widths (≥1920px). Common laptop scalings
// don't have the vertical room — 14" MBP renders at 1512 (default) or 1728
// ("More Space"), 16" MBP at 1728 / 1920. Below 1920 we render 2 posts so
// the card fits inside the hero section without the bottom getting clipped.
function useTweetLimit() {
  const [limit, setLimit] = useState(2);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1920px)");
    const update = () => setLimit(mq.matches ? 3 : 2);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return limit;
}

export function TweetOverlayHero() {
  const limit = useTweetLimit();
  const [platform, setPlatform] = useState<Platform>("x");
  const tweets = TWEETS.slice(0, limit);
  const reddits = REDDIT_POSTS.slice(0, limit);
  const blueskies = BLUESKY_POSTS.slice(0, limit);
  const bloombergs = BLOOMBERG_ARTICLES.slice(0, limit);
  const visibleLen =
    platform === "x"
      ? tweets.length
      : platform === "reddit"
        ? reddits.length
        : platform === "bluesky"
          ? blueskies.length
          : bloombergs.length;
  const [activeIdx, setActiveIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>(0);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Auto-flip platform after a full pass through the current feed. The
  // cycle below arms `flipPendingRef` when the modulo wraps; this effect
  // consumes it on the next render. Gating with the ref instead of a
  // raw `activeIdx === 0` check avoids racing with manual tab clicks
  // (which also reset activeIdx to 0 but shouldn't trigger a swap).
  // Order: x → reddit → bluesky → x → …
  const flipPendingRef = useRef(false);
  useEffect(() => {
    if (flipPendingRef.current && activeIdx === 0) {
      flipPendingRef.current = false;
      setPlatform((p) =>
        p === "x"
          ? "reddit"
          : p === "reddit"
            ? "bluesky"
            : p === "bluesky"
              ? "bloomberg"
              : "x"
      );
    }
  }, [activeIdx]);

  // Reset and restart the cycle on platform/length changes — the user is
  // now looking at a new feed, so start from the top with a fresh phase
  // sequence. Referencing `platform` in the body so the lint rule sees
  // the dep as load-bearing.
  useEffect(() => {
    void platform;
    setActiveIdx(0);
    const schedule = (fn: () => void, delay: number) => {
      const id = setTimeout(fn, delay);
      timeoutsRef.current.push(id);
    };

    const cycle = () => {
      setPhase(0);
      schedule(() => {
        setPhase(1);
        schedule(() => {
          setPhase(2);
          schedule(() => {
            setActiveIdx((i) => {
              const next = (i + 1) % visibleLen;
              // Arm auto-flip when we wrap back to the top of the feed.
              if (next === 0) flipPendingRef.current = true;
              return next;
            });
            cycle();
          }, 4500);
        }, 1100);
      }, 1400);
    };

    cycle();
    return () => {
      for (const id of timeoutsRef.current) clearTimeout(id);
      timeoutsRef.current = [];
    };
  }, [visibleLen, platform]);

  const isX = platform === "x";
  const isReddit = platform === "reddit";
  const isBluesky = platform === "bluesky";
  const activePost = isX
    ? tweets[activeIdx]
    : isReddit
      ? reddits[activeIdx]
      : isBluesky
        ? blueskies[activeIdx]
        : bloombergs[activeIdx];
  const phaseLabel =
    phase === 0
      ? `Watching · ${visibleLen} posts in feed`
      : phase === 1
        ? `Scanning post ${activeIdx + 1} for claims…`
        : `Match found · ${activePost?.market.match ?? 0}% confidence`;

  return (
    <div className="kwt-root" data-platform={platform}>
      <div className="kwt-card">
        <div className="kwt-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={platform === "x"}
            className={`kwt-tab${platform === "x" ? " kwt-tab-active" : ""}`}
            onClick={() => setPlatform("x")}
          >
            <span className="kwt-tab-logo kwt-tab-logo-x">{XLogo}</span>
            <span className="kwt-tab-label">x.com</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={platform === "reddit"}
            className={`kwt-tab${platform === "reddit" ? " kwt-tab-active" : ""}`}
            onClick={() => setPlatform("reddit")}
          >
            <span className="kwt-tab-logo kwt-tab-logo-reddit">
              {RedditLogo}
            </span>
            <span className="kwt-tab-label">reddit.com</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={platform === "bluesky"}
            className={`kwt-tab${platform === "bluesky" ? " kwt-tab-active" : ""}`}
            onClick={() => setPlatform("bluesky")}
          >
            <span className="kwt-tab-logo kwt-tab-logo-bluesky">
              {BlueskyLogo}
            </span>
            <span className="kwt-tab-label">bsky.app</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={platform === "bloomberg"}
            className={`kwt-tab${platform === "bloomberg" ? " kwt-tab-active" : ""}`}
            onClick={() => setPlatform("bloomberg")}
          >
            <span className="kwt-tab-logo kwt-tab-logo-bloomberg">
              {BloombergLogo}
            </span>
            <span className="kwt-tab-label">bloomberg.com</span>
          </button>
          <span className="kwt-tab-rail" aria-hidden="true" />
        </div>

        <header className="kwt-chrome">
          <div className="kwt-dots">
            <span />
            <span />
            <span />
          </div>
          <div className="kwt-addr">
            <span className="kwt-lock">⌬</span>
            <span>
              {isX
                ? "x.com"
                : isReddit
                  ? "reddit.com"
                  : isBluesky
                    ? "bsky.app"
                    : "bloomberg.com"}
            </span>
            <span className="kwt-addr-dim">
              {isX
                ? "/home"
                : isReddit
                  ? "/r/all"
                  : isBluesky
                    ? "/profile"
                    : "/markets"}
            </span>
          </div>
          <div className="kwt-ext">
            <span className="kwt-k-mark">K</span>
            <span className="kwt-ext-label">Knoww</span>
            <span className={`kwt-pulse${phase === 1 ? " kwt-on" : ""}`} />
          </div>
        </header>

        <div className={`kwt-feed kwt-feed-${platform}`} key={platform}>
          {isX
            ? tweets.map((t, i) => (
                <div
                  key={i}
                  className={`kwt-feed-item${i === activeIdx ? " kwt-active" : ""}`}
                >
                  <TweetItem t={t} active={i === activeIdx} phase={phase} />
                </div>
              ))
            : isReddit
              ? reddits.map((p, i) => (
                  <div
                    key={i}
                    className={`kwt-feed-item${i === activeIdx ? " kwt-active" : ""}`}
                  >
                    <RedditItem p={p} active={i === activeIdx} phase={phase} />
                  </div>
                ))
              : isBluesky
                ? blueskies.map((p, i) => (
                    <div
                      key={i}
                      className={`kwt-feed-item${i === activeIdx ? " kwt-active" : ""}`}
                    >
                      <BlueskyItem
                        p={p}
                        active={i === activeIdx}
                        phase={phase}
                      />
                    </div>
                  ))
                : bloombergs.map((a, i) => (
                    <div
                      key={i}
                      className={`kwt-feed-item${i === activeIdx ? " kwt-active" : ""}`}
                    >
                      <BloombergItem
                        a={a}
                        active={i === activeIdx}
                        phase={phase}
                      />
                    </div>
                  ))}
        </div>

        <footer className="kwt-status">
          <div className="kwt-status-left">
            <span className="kwt-k-mark kwt-k-mark-sm">K</span>
            <span className="kwt-status-label">{phaseLabel}</span>
          </div>
          <div className="kwt-phase">
            {Array.from({ length: visibleLen }).map((_, i) => (
              <span
                key={i}
                className={`kwt-phase-bar${
                  i === activeIdx ? " kwt-on" : i < activeIdx ? " kwt-done" : ""
                }`}
              />
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}
