"use client";

import type { KeyboardEvent } from "react";
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

const PLATFORMS: Platform[] = ["x", "reddit", "bluesky", "bloomberg"];

const PLATFORM_LABELS: Record<Platform, string> = {
  x: "x.com",
  reddit: "reddit.com",
  bluesky: "bsky.app",
  bloomberg: "bloomberg.com",
};

export function TweetOverlayHero() {
  const [platform, setPlatform] = useState<Platform>("x");
  // Render the full feed for every platform; the fixed-height card clips the
  // overflow, so each card size shows as many posts as fit and never looks
  // half-empty.
  const tweets = TWEETS;
  const reddits = REDDIT_POSTS;
  const blueskies = BLUESKY_POSTS;
  const bloombergs = BLOOMBERG_ARTICLES;
  const visibleLen =
    platform === "x"
      ? tweets.length
      : platform === "reddit"
        ? reddits.length
        : platform === "bluesky"
          ? blueskies.length
          : bloombergs.length;
  // Only the top posts ever get a market card injected, so the matched card
  // stays high in the feed (always visible); the posts below are filler that
  // the injection pushes down and the fixed-height card clips.
  const matchCount = Math.min(2, visibleLen);
  const [activeIdx, setActiveIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>(0);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const tablistRef = useRef<HTMLDivElement | null>(null);
  const flipPendingRef = useRef(false);

  const selectPlatform = (nextPlatform: Platform) => {
    flipPendingRef.current = false;
    for (const id of timeoutsRef.current) clearTimeout(id);
    timeoutsRef.current = [];
    setPlatform(nextPlatform);
  };

  const handlePlatformKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentPlatform: Platform
  ) => {
    const currentIndex = PLATFORMS.indexOf(currentPlatform);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % PLATFORMS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + PLATFORMS.length) % PLATFORMS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = PLATFORMS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextPlatform = PLATFORMS[nextIndex];
    selectPlatform(nextPlatform);
    document.getElementById(`kwt-tab-${nextPlatform}`)?.focus();
  };

  // Auto-flip platform after a full pass through the current feed. The
  // cycle below arms `flipPendingRef` when the modulo wraps; this effect
  // consumes it on the next render. Gating with the ref instead of a
  // raw `activeIdx === 0` check avoids racing with manual tab clicks
  // (which also reset activeIdx to 0 but shouldn't trigger a swap).
  // Order: x → reddit → bluesky → x → …
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
              // Cycle only through the top `matchCount` posts so the injected
              // market card always stays high in the feed.
              const next = (i + 1) % matchCount;
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
  }, [matchCount, platform]);

  useEffect(() => {
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      tablistRef.current?.contains(activeElement)
    ) {
      document.getElementById(`kwt-tab-${platform}`)?.focus();
    }
  }, [platform]);

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
        <div
          ref={tablistRef}
          className="kwt-tabs"
          role="tablist"
          aria-label="Platform preview"
        >
          <button
            id="kwt-tab-x"
            type="button"
            role="tab"
            aria-selected={platform === "x"}
            aria-controls="kwt-panel-x"
            tabIndex={platform === "x" ? 0 : -1}
            className={`kwt-tab${platform === "x" ? " kwt-tab-active" : ""}`}
            onClick={() => selectPlatform("x")}
            onKeyDown={(event) => handlePlatformKeyDown(event, "x")}
          >
            <span className="kwt-tab-logo kwt-tab-logo-x">{XLogo}</span>
            <span className="kwt-tab-label">{PLATFORM_LABELS.x}</span>
          </button>
          <button
            id="kwt-tab-reddit"
            type="button"
            role="tab"
            aria-selected={platform === "reddit"}
            aria-controls="kwt-panel-reddit"
            tabIndex={platform === "reddit" ? 0 : -1}
            className={`kwt-tab${platform === "reddit" ? " kwt-tab-active" : ""}`}
            onClick={() => selectPlatform("reddit")}
            onKeyDown={(event) => handlePlatformKeyDown(event, "reddit")}
          >
            <span className="kwt-tab-logo kwt-tab-logo-reddit">
              {RedditLogo}
            </span>
            <span className="kwt-tab-label">{PLATFORM_LABELS.reddit}</span>
          </button>
          <button
            id="kwt-tab-bluesky"
            type="button"
            role="tab"
            aria-selected={platform === "bluesky"}
            aria-controls="kwt-panel-bluesky"
            tabIndex={platform === "bluesky" ? 0 : -1}
            className={`kwt-tab${platform === "bluesky" ? " kwt-tab-active" : ""}`}
            onClick={() => selectPlatform("bluesky")}
            onKeyDown={(event) => handlePlatformKeyDown(event, "bluesky")}
          >
            <span className="kwt-tab-logo kwt-tab-logo-bluesky">
              {BlueskyLogo}
            </span>
            <span className="kwt-tab-label">{PLATFORM_LABELS.bluesky}</span>
          </button>
          <button
            id="kwt-tab-bloomberg"
            type="button"
            role="tab"
            aria-selected={platform === "bloomberg"}
            aria-controls="kwt-panel-bloomberg"
            tabIndex={platform === "bloomberg" ? 0 : -1}
            className={`kwt-tab${platform === "bloomberg" ? " kwt-tab-active" : ""}`}
            onClick={() => selectPlatform("bloomberg")}
            onKeyDown={(event) => handlePlatformKeyDown(event, "bloomberg")}
          >
            <span className="kwt-tab-logo kwt-tab-logo-bloomberg">
              {BloombergLogo}
            </span>
            <span className="kwt-tab-label">{PLATFORM_LABELS.bloomberg}</span>
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
            <span>{PLATFORM_LABELS[platform]}</span>
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

        <div
          id="kwt-panel-x"
          className="kwt-feed kwt-feed-x"
          role="tabpanel"
          aria-labelledby="kwt-tab-x"
          hidden={platform !== "x"}
        >
          {tweets.map((t, i) => (
            <div
              key={i}
              className={`kwt-feed-item${i === activeIdx ? " kwt-active" : ""}`}
            >
              <TweetItem t={t} active={i === activeIdx} phase={phase} />
            </div>
          ))}
        </div>

        <div
          id="kwt-panel-reddit"
          className="kwt-feed kwt-feed-reddit"
          role="tabpanel"
          aria-labelledby="kwt-tab-reddit"
          hidden={platform !== "reddit"}
        >
          {reddits.map((p, i) => (
            <div
              key={i}
              className={`kwt-feed-item${i === activeIdx ? " kwt-active" : ""}`}
            >
              <RedditItem p={p} active={i === activeIdx} phase={phase} />
            </div>
          ))}
        </div>

        <div
          id="kwt-panel-bluesky"
          className="kwt-feed kwt-feed-bluesky"
          role="tabpanel"
          aria-labelledby="kwt-tab-bluesky"
          hidden={platform !== "bluesky"}
        >
          {blueskies.map((p, i) => (
            <div
              key={i}
              className={`kwt-feed-item${i === activeIdx ? " kwt-active" : ""}`}
            >
              <BlueskyItem p={p} active={i === activeIdx} phase={phase} />
            </div>
          ))}
        </div>

        <div
          id="kwt-panel-bloomberg"
          className="kwt-feed kwt-feed-bloomberg"
          role="tabpanel"
          aria-labelledby="kwt-tab-bloomberg"
          hidden={platform !== "bloomberg"}
        >
          {bloombergs.map((a, i) => (
            <div
              key={i}
              className={`kwt-feed-item${i === activeIdx ? " kwt-active" : ""}`}
            >
              <BloombergItem a={a} active={i === activeIdx} phase={phase} />
            </div>
          ))}
        </div>

        <footer className="kwt-status">
          <div className="kwt-status-left">
            <span className="kwt-k-mark kwt-k-mark-sm">K</span>
            <span className="kwt-status-label">{phaseLabel}</span>
          </div>
          <div className="kwt-phase">
            {Array.from({ length: matchCount }).map((_, i) => (
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
