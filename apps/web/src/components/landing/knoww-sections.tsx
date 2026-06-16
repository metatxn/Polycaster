/**
 * Redesigned landing sections — the "prediction-layer" narrative from the
 * Knoww.App handoff design, rebuilt against the editorial --kw- token system
 * so every surface tracks the light/dark toggle and reuses the site fonts
 * (Plus Jakarta Sans / Fraunces / JetBrains Mono). No hard-coded palette:
 * accents derive from --kw-accent via the helpers in globals.css.
 *
 * The hero (heading + TweetOverlayHero) lives in the server page at
 * src/app/page.tsx; this file owns everything below it. These sections are
 * server components — the two interval-driven widgets live in
 * knoww-sections-live.tsx so everything here stays zero-hydration markup.
 */

import {
  Activity,
  ArrowRight,
  Bell,
  Box,
  Cpu,
  Eye,
  Flame,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { AgentDashboard, ExtensionPopup } from "./knoww-sections-live";

/* ------------------------------------------------------------------ */
/* Shared bits                                                        */
/* ------------------------------------------------------------------ */

/** Mono section marker — "02 / The Problem" with an accent index. */
function SectionLabel({ n, label }: { n: string; label: string }) {
  return (
    <div className="kw-reveal mb-5 inline-flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em]">
      <span className="text-(--kw-accent-text)">{n}</span>
      <span className="text-(--kw-fg)/30">/</span>
      <span className="text-(--kw-fg)/60">{label}</span>
    </div>
  );
}

const SECTION =
  "border-b border-(--kw-fg)/10 w-full max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 py-20 md:py-28 lg:py-32";

/* ------------------------------------------------------------------ */
/* 1 — Problem                                                        */
/* ------------------------------------------------------------------ */

const COMMENTS: Array<{ t: string; x: number; y: number; r: number }> = [
  { t: "“This is definitely happening.”", x: 4, y: 8, r: -4 },
  { t: "“No chance.”", x: 64, y: 4, r: 6 },
  { t: "“Markets are underpricing this.”", x: 30, y: 22, r: 2 },
  { t: "“Source?”", x: 2, y: 40, r: -2 },
  { t: "“This changes everything.”", x: 58, y: 36, r: -3 },
  { t: "“It’s priced in already.”", x: 70, y: 54, r: 4 },
  { t: "“Cope.”", x: 6, y: 64, r: 3 },
  { t: "“Big if true.”", x: 40, y: 72, r: -2 },
];

export function ProblemSection() {
  return (
    <section className="bg-(--kw-bg-alt)">
      <div className={SECTION}>
        <SectionLabel n="02" label="The Problem" />
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="kw-reveal">
            <h2 className="text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl">
              The internet runs on opinions.
              <br />
              <span className="text-(--kw-fg)/65">Knoww adds</span>{" "}
              <span className="text-(--kw-accent-text)">probabilities.</span>
            </h2>
            <p className="mt-6 max-w-[52ch] text-base leading-[1.6] text-(--kw-fg)/80">
              Every day, people debate elections, crypto, sports, AI, wars,
              rates, launches, and public figures. But most online discussion is
              driven by vibes, bias, and engagement farming.
            </p>
            <p className="mt-4 max-w-[52ch] text-base leading-[1.6] text-(--kw-fg)/80">
              Prediction markets have better signal — they just live in another
              tab. Users have to leave the platform, search manually, parse
              market wording, then act.{" "}
              <span className="text-(--kw-fg)">
                Knoww removes that friction.
              </span>
            </p>
          </div>

          {/* Chaos → probability visual */}
          <div
            className="kw-reveal relative h-[440px] overflow-hidden rounded-[20px] border border-(--kw-fg)/10 bg-(--kw-bg-card)/60"
            style={{
              backgroundImage:
                "radial-gradient(600px 300px at 50% 0%, color-mix(in srgb, var(--kw-danger-bright) 9%, transparent), transparent 60%)",
            }}
          >
            <div className="absolute inset-0 opacity-90">
              {COMMENTS.map((c, i) => (
                <div
                  key={c.t}
                  className="kw-float absolute whitespace-nowrap rounded-[10px] border border-(--kw-fg)/10 bg-(--kw-fg)/4 px-3 py-2 text-[12.5px] text-(--kw-fg)/75"
                  style={{
                    left: `${c.x}%`,
                    top: `${c.y}%`,
                    transform: `rotate(${c.r}deg)`,
                    animationDelay: `${i * 0.2}s`,
                    animationDuration: `${4 + i * 0.4}s`,
                  }}
                >
                  {c.t}
                </div>
              ))}
            </div>

            <div className="absolute left-1/2 top-[50%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
              <span className="font-mono text-[10px] tracking-[0.18em] text-(--kw-accent-text)">
                KNOWW
              </span>
              <span className="h-7 w-px bg-linear-to-b from-transparent to-(--kw-accent)" />
              <ArrowRight className="h-4 w-4 rotate-90 text-(--kw-accent-text)" />
            </div>

            <div className="absolute inset-x-5 bottom-5 flex gap-2">
              <div className="flex flex-1 items-center justify-between rounded-[10px] border border-(--kw-accent)/30 bg-(--kw-accent)/10 px-3 py-2.5">
                <span className="font-mono text-[11px] text-(--kw-accent-text)">
                  YES
                </span>
                <span className="font-semibold text-(--kw-accent-text)">
                  64%
                </span>
              </div>
              <div className="flex flex-1 items-center justify-between rounded-[10px] border border-(--kw-danger-bright)/25 bg-(--kw-danger-bright)/10 px-3 py-2.5">
                <span className="font-mono text-[11px] text-(--kw-danger-text)">
                  NO
                </span>
                <span className="font-semibold text-(--kw-danger-text)">
                  36%
                </span>
              </div>
              <div className="flex flex-1 items-center justify-between rounded-[10px] border border-(--kw-fg)/10 bg-(--kw-fg)/3 px-3 py-2.5">
                <span className="font-mono text-[11px] text-(--kw-fg)/70">
                  VOL
                </span>
                <span className="font-mono font-medium text-(--kw-fg)">
                  $2.4M
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2 — Solution                                                       */
/* ------------------------------------------------------------------ */

function FeatureCard({
  num,
  icon,
  title,
  desc,
}: {
  num: string;
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="kw-reveal kw-card-lift relative overflow-hidden rounded-[18px] border border-(--kw-fg)/10 bg-(--kw-bg-card)/50 p-7">
      <span className="absolute right-5 top-5 font-mono text-[11px] tracking-[0.08em] text-(--kw-fg)/30">
        {num}
      </span>
      <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-(--kw-accent)/25 bg-(--kw-accent)/10 text-(--kw-accent-text)">
        {icon}
      </div>
      <h3 className="mb-2 text-lg font-semibold tracking-[-0.018em]">
        {title}
      </h3>
      <p className="text-[15px] leading-[1.6] text-(--kw-fg)/75">{desc}</p>
    </div>
  );
}

export function SolutionSection() {
  return (
    <section id="solution">
      <div className={SECTION}>
        <SectionLabel n="03" label="The Solution" />
        <div className="mb-12 grid grid-cols-1 items-end gap-8 md:grid-cols-12">
          <h2 className="kw-reveal text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:col-span-7 md:text-5xl">
            Knoww brings the market
            <br />
            to the{" "}
            <span className="kw-editorial italic">moment of intent.</span>
          </h2>
          <p className="kw-reveal text-base leading-[1.6] text-(--kw-fg)/80 md:col-span-5">
            Curiosity, disagreement, fear, greed. The reasons people open a
            market start with a feed — not a search bar. Knoww lives where that
            intent appears.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FeatureCard
            num="F.01"
            icon={<Eye className="h-[18px] w-[18px]" />}
            title="Context-aware market discovery"
            desc="Knoww analyzes tweets, articles, posts, and pages to understand what event is being discussed — entities, dates, claims, and uncertainty."
          />
          <FeatureCard
            num="F.02"
            icon={<Target className="h-[18px] w-[18px]" />}
            title="Live odds inside any website"
            desc="Relevant prediction markets appear directly inside your browsing experience. No new tab. No new app. The market comes to the moment."
          />
          <FeatureCard
            num="F.03"
            icon={<Zap className="h-[18px] w-[18px]" />}
            title="Trade without breaking flow"
            desc="View outcomes, compare odds, and place positions from the same page. Settlement happens on Polymarket; your context never breaks."
          />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3 — Extension                                                      */
/* ------------------------------------------------------------------ */

const PLATFORMS: Array<{ n: string; soon?: boolean }> = [
  { n: "X / Twitter" },
  { n: "Reddit" },
  { n: "News sites" },
  { n: "Crypto media" },
  { n: "Finance sites" },
  { n: "Google Search" },
  { n: "Discord Web" },
  { n: "Substack" },
  { n: "Hacker News" },
  { n: "Bloomberg" },
  { n: "More coming soon", soon: true },
];

export function ExtensionSection() {
  return (
    <section id="extension">
      <div className={SECTION}>
        <SectionLabel n="04" label="Chrome Extension" />
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
          <div className="kw-reveal">
            <h2 className="text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl">
              One extension.
              <br />
              50+ websites.
              <br />
              <span className="text-(--kw-accent-text)">Infinite markets.</span>
            </h2>
            <p className="mt-6 max-w-[52ch] text-base leading-[1.6] text-(--kw-fg)/80">
              Wherever the internet debates uncertainty, Knoww is there. Reading
              news, scrolling feeds, watching analysis, tracking narratives —
              the extension detects context and surfaces relevant markets.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              {PLATFORMS.map((p) => (
                <span
                  key={p.n}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-colors ${
                    p.soon
                      ? "border-dashed border-(--kw-fg)/15 text-(--kw-fg)/65"
                      : "border-(--kw-fg)/10 bg-(--kw-fg)/3 text-(--kw-fg)/80 hover:border-(--kw-fg)/20"
                  }`}
                >
                  {!p.soon && (
                    <span className="h-1.5 w-1.5 rounded-full bg-(--kw-accent)" />
                  )}
                  {p.n}
                </span>
              ))}
            </div>
          </div>

          <div className="relative flex justify-center">
            <div className="kw-glow-halo -inset-10" />
            <ExtensionPopup />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 4 — How it works                                                   */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    n: "01",
    t: "Read",
    d: "User sees a post, article, headline, or comment.",
    icon: <Eye className="h-3.5 w-3.5" />,
  },
  {
    n: "02",
    t: "Analyze",
    d: "Knoww parses entities, claims, and uncertainty.",
    icon: <Sparkles className="h-3.5 w-3.5" />,
  },
  {
    n: "03",
    t: "Match",
    d: "The most relevant prediction market is selected.",
    icon: <Target className="h-3.5 w-3.5" />,
  },
  {
    n: "04",
    t: "Act",
    d: "Live odds appear. User can take a position instantly.",
    icon: <Zap className="h-3.5 w-3.5" />,
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="bg-(--kw-bg-alt)">
      <div className={SECTION}>
        <SectionLabel n="05" label="How it works" />
        <h2 className="kw-reveal max-w-[900px] text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl">
          From internet debate to{" "}
          <span className="text-(--kw-accent-text)">market signal</span> in
          seconds.
        </h2>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="kw-reveal rounded-[16px] border border-(--kw-fg)/10 bg-(--kw-bg-card)/50 p-6"
            >
              <div className="font-mono text-[11px] tracking-widest text-(--kw-accent-text)">
                STEP {s.n}
              </div>
              <div className="mt-2 flex items-center gap-2.5">
                <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-(--kw-accent)/25 bg-(--kw-accent)/10 text-(--kw-accent-text)">
                  {s.icon}
                </span>
                <h3 className="text-lg font-semibold">{s.t}</h3>
              </div>
              <p className="mt-2 text-[14px] leading-[1.55] text-(--kw-fg)/75">
                {s.d}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 5 — Probability radar                                              */
/* ------------------------------------------------------------------ */

const RADAR_CATS = [
  { l: "ELECTIONS", x: 50, y: 5 },
  { l: "CRYPTO", x: 92, y: 26 },
  { l: "AI", x: 97, y: 60 },
  { l: "SPORTS", x: 80, y: 93 },
  { l: "MACRO", x: 38, y: 97 },
  { l: "POLICY", x: 5, y: 78 },
  { l: "CULTURE", x: 2, y: 38 },
];
const RADAR_BLIPS = [
  { x: 65, y: 30, d: "0s" },
  { x: 30, y: 60, d: "0.8s" },
  { x: 70, y: 70, d: "1.6s" },
  { x: 40, y: 35, d: "2.4s" },
  { x: 22, y: 48, d: "1.2s" },
];
const RADAR_FEED = [
  { l: "Elections", v: "14 new" },
  { l: "Crypto", v: "38 new" },
  { l: "Sports", v: "22 new" },
  { l: "AI", v: "9 new" },
  { l: "Macro", v: "11 new" },
  { l: "Policy", v: "7 new" },
];

export function RadarBlock() {
  return (
    <section>
      <div className={SECTION}>
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
          <div className="kw-reveal flex justify-center">
            <div className="kw-radar">
              <div className="kw-radar-ring r2" />
              <div className="kw-radar-ring r3" />
              <div className="kw-radar-ring r4" />
              <div className="kw-radar-cross absolute inset-0" />
              <div className="kw-radar-sweep" />
              {RADAR_BLIPS.map((b) => (
                <span
                  key={`${b.x}-${b.y}`}
                  className="kw-radar-blip"
                  style={{
                    left: `${b.x}%`,
                    top: `${b.y}%`,
                    animationDelay: b.d,
                  }}
                />
              ))}
              {RADAR_CATS.map((c) => (
                <span
                  key={c.l}
                  className="absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-(--kw-fg)/70"
                  style={{ left: `${c.x}%`, top: `${c.y}%` }}
                >
                  {c.l}
                </span>
              ))}
              <div className="kw-radar-center font-mono text-[9px] font-bold tracking-[0.08em] text-(--kw-bg)">
                SCAN
              </div>
            </div>
          </div>

          <div>
            <SectionLabel n="R" label="Probability radar" />
            <h2 className="kw-reveal text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl">
              Knoww is constantly scanning
              <br />
              the internet for{" "}
              <span className="text-(--kw-accent-text)">uncertainty</span>.
            </h2>
            <p className="kw-reveal mt-6 max-w-[52ch] text-base leading-[1.6] text-(--kw-fg)/80">
              Politics, crypto, sports, AI, macro, policy, culture — every
              domain has a hidden market. The radar shows what Knoww just found.
            </p>
            <div className="kw-reveal mt-6 grid max-w-[460px] grid-cols-2 gap-2">
              {RADAR_FEED.map((d) => (
                <div
                  key={d.l}
                  className="flex justify-between rounded-[8px] border border-(--kw-fg)/10 bg-(--kw-fg)/2 px-3 py-2 font-mono text-[12px]"
                >
                  <span className="text-(--kw-fg)/70">{d.l}</span>
                  <span className="text-(--kw-accent-text)">{d.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 6 — AI Agent                                                       */
/* ------------------------------------------------------------------ */

const AGENT_BULLETS = [
  { icon: <TrendingUp className="h-3.5 w-3.5" />, t: "Market monitoring" },
  { icon: <Bell className="h-3.5 w-3.5" />, t: "Odds movement alerts" },
  { icon: <Search className="h-3.5 w-3.5" />, t: "Event / context analysis" },
  { icon: <Sparkles className="h-3.5 w-3.5" />, t: "Trade suggestions" },
  { icon: <Wallet className="h-3.5 w-3.5" />, t: "Portfolio & risk controls" },
  { icon: <Eye className="h-3.5 w-3.5" />, t: "Transparent reasoning" },
];

export function AgentSection() {
  return (
    <section id="agent">
      <div className={SECTION}>
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <SectionLabel n="06" label="AI Agent Layer" />
            <h2 className="kw-reveal text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl">
              Next: agents that
              <br />
              <span className="text-(--kw-accent-text)">
                monitor the future
              </span>{" "}
              for you.
            </h2>
            <p className="kw-reveal mt-6 max-w-[52ch] text-base leading-[1.6] text-(--kw-fg)/80">
              Knoww is building an agent layer that monitors markets, tracks
              narratives, detects odds movement, analyzes events, and helps
              users act inside{" "}
              <em className="text-(--kw-fg) not-italic">user-defined</em> risk
              controls. Transparent reasoning. No black box.
            </p>
            <div className="kw-reveal mt-7 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {AGENT_BULLETS.map((b) => (
                <div
                  key={b.t}
                  className="flex items-center gap-2.5 rounded-[10px] border border-(--kw-fg)/10 bg-(--kw-fg)/2 px-3 py-2.5"
                >
                  <span className="text-(--kw-accent-text)">{b.icon}</span>
                  <span className="text-[13px] text-(--kw-fg)/80">{b.t}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="kw-reveal">
            <AgentDashboard />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 7 — Why now                                                        */
/* ------------------------------------------------------------------ */

export function WhyNowSection() {
  return (
    <section className="bg-(--kw-bg-alt)">
      <div className={SECTION}>
        <SectionLabel n="07" label="Why now" />
        <div className="mb-12 grid grid-cols-1 items-end gap-8 md:grid-cols-12">
          <h2 className="kw-reveal text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:col-span-7 md:text-5xl">
            Prediction markets are ready.
            <br />
            <span className="text-(--kw-fg)/65">Discovery is still </span>
            <span className="text-(--kw-danger-text)">broken</span>
            <span className="text-(--kw-fg)/65">.</span>
          </h2>
          <p className="kw-reveal text-base leading-[1.6] text-(--kw-fg)/80 md:col-span-5">
            People don’t start with a market. They start with curiosity,
            disagreement, fear, or a live event. Knoww captures intent at the
            source.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="kw-reveal rounded-[18px] border border-(--kw-danger-bright)/15 bg-(--kw-danger-bright)/4 p-7">
            <h3 className="font-mono text-[14px] uppercase tracking-widest text-(--kw-fg)/60">
              The old way
            </h3>
            <div className="mt-4 space-y-2.5">
              {[
                "Open Polymarket",
                "Search manually",
                "Find relevant market",
                "Understand wording",
                "Place trade",
              ].map((s, i) => (
                <div
                  key={s}
                  className="flex items-center gap-3 rounded-[11px] border border-(--kw-fg)/10 bg-(--kw-fg)/2 px-3.5 py-3 text-[14px]"
                >
                  <span className="w-5 font-mono text-[11px] text-(--kw-fg)/35">
                    0{i + 1}
                  </span>
                  <span className="text-(--kw-fg)/75">{s}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 font-mono text-[12px] text-(--kw-danger-text)">
              ≈ 2–4 minutes · 60% drop-off
            </div>
          </div>

          <div className="kw-reveal rounded-[18px] border border-(--kw-accent)/22 bg-(--kw-accent)/5 p-7">
            <h3 className="font-mono text-[14px] uppercase tracking-widest text-(--kw-accent-text)">
              The Knoww way
            </h3>
            <div className="mt-4 space-y-2.5">
              {["See post", "Market appears", "View odds", "Act instantly"].map(
                (s, i) => (
                  <div
                    key={s}
                    className="flex items-center gap-3 rounded-[11px] border border-(--kw-accent)/18 bg-(--kw-accent)/6 px-3.5 py-3 text-[14px]"
                  >
                    <span className="w-5 font-mono text-[11px] text-(--kw-accent-text)">
                      0{i + 1}
                    </span>
                    <span className="text-(--kw-fg)">{s}</span>
                  </div>
                )
              )}
            </div>
            <div className="mt-4 font-mono text-[12px] text-(--kw-accent-text)">
              ≈ 6 seconds · zero context switch
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 8 — Use cases                                                      */
/* ------------------------------------------------------------------ */

const USE_CASES = [
  {
    icon: <Box className="h-[18px] w-[18px]" />,
    t: "Crypto traders",
    d: "Track narratives and event-driven markets directly from crypto Twitter and on-chain feeds.",
  },
  {
    icon: <Flame className="h-[18px] w-[18px]" />,
    t: "Politics watchers",
    d: "See live election and policy odds while reading news, op-eds, or social commentary.",
  },
  {
    icon: <Target className="h-[18px] w-[18px]" />,
    t: "Sports fans",
    d: "Discover relevant markets while following games, injury reports, and trade rumors.",
  },
  {
    icon: <TrendingUp className="h-[18px] w-[18px]" />,
    t: "News junkies",
    d: "Turn breaking news into measurable probabilities, not vibes.",
  },
  {
    icon: <Sparkles className="h-[18px] w-[18px]" />,
    t: "Creators & analysts",
    d: "Add live odds and market context to posts, threads, and videos.",
  },
  {
    icon: <Cpu className="h-[18px] w-[18px]" />,
    t: "Power users",
    d: "Use agents, alerts, and dashboards to monitor what actually matters.",
  },
];

export function UseCasesSection() {
  return (
    <section id="use-cases">
      <div className={SECTION}>
        <SectionLabel n="08" label="Use cases" />
        <div className="mb-12 grid grid-cols-1 items-end gap-8 md:grid-cols-12">
          <h2 className="kw-reveal text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:col-span-7 md:text-5xl">
            For everyone who wants
            <br />
            <span className="kw-editorial italic">
              signal before consensus.
            </span>
          </h2>
          <p className="kw-reveal text-base leading-[1.6] text-(--kw-fg)/80 md:col-span-5">
            Knoww isn’t a niche product — it’s a layer. Anyone who reads,
            debates, or trades on the internet has something to gain.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {USE_CASES.map((c, i) => (
            <FeatureCard
              key={c.t}
              num={`U.0${i + 1}`}
              icon={c.icon}
              title={c.t}
              desc={c.d}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 9 — Traction                                                       */
/* ------------------------------------------------------------------ */

const METRICS = [
  { label: "Extension", v: "Shipped", sub: "Chrome MV3 · v0.9" },
  { label: "Coverage", v: "50+", sub: "supported websites" },
  { label: "Matching", v: "91%", sub: "avg. context confidence" },
  { label: "Markets", v: "14K+", sub: "via Polymarket" },
  { label: "Latency", v: "< 500ms", sub: "detect-to-render" },
  { label: "Agent layer", v: "Alpha", sub: "internal testing" },
  { label: "Waitlist", v: "7,400", sub: "and growing" },
  { label: "Public launch", v: "Soon", sub: "2026" },
];

export function TractionSection() {
  return (
    <section className="bg-(--kw-bg-alt)">
      <div className={SECTION}>
        <SectionLabel n="09" label="Where we are" />
        <div className="mb-12 grid grid-cols-1 items-end gap-8 md:grid-cols-12">
          <h2 className="kw-reveal text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:col-span-7 md:text-5xl">
            Built fast.
            <br />
            Already working{" "}
            <span className="text-(--kw-accent-text)">across the internet</span>
            .
          </h2>
          <p className="kw-reveal text-base leading-[1.6] text-(--kw-fg)/80 md:col-span-5">
            We shipped the foundation. Now we’re hardening, expanding coverage,
            and opening the doors.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {METRICS.map((m) => (
            <div
              key={m.label}
              className="kw-reveal rounded-[16px] border border-(--kw-fg)/10 bg-(--kw-bg-card)/50 p-5"
            >
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-(--kw-fg)/70">
                {m.label}
              </div>
              <div className="mt-2 text-[32px] font-medium tracking-tight">
                {m.v}
              </div>
              <div className="mt-1 font-mono text-[12px] text-(--kw-fg)/70">
                {m.sub}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 10 — Final CTA                                                     */
/* ------------------------------------------------------------------ */

export function FinalCTASection({
  chromeStoreUrl,
}: {
  chromeStoreUrl: string;
}) {
  return (
    <section id="cta">
      <div className="mx-auto w-full max-w-[1280px] 2xl:max-w-[1440px] px-6 py-20 sm:px-8 md:py-28">
        <div
          className="relative overflow-hidden rounded-[22px] border border-(--kw-fg)/15 px-6 py-20 text-center md:px-12"
          style={{
            background:
              "radial-gradient(600px 300px at 50% 0%, var(--kw-accent-soft), transparent 60%), var(--kw-bg-card)",
          }}
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-(--kw-fg)/15 bg-(--kw-fg)/2 px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-(--kw-fg)/70">
            <span className="kw-signal-dot h-1.5 w-1.5" />
            Closed beta · 7,400 on the waitlist
          </span>
          <h2 className="mx-auto mt-6 max-w-[900px] text-4xl font-bold leading-[1.04] tracking-[-0.035em] md:text-6xl">
            The future won’t just be discussed.
            <br />
            <span className="kw-editorial italic text-(--kw-accent-text)">
              It’ll be priced.
            </span>
          </h2>
          <p className="mx-auto mt-5 max-w-[60ch] text-base leading-[1.6] text-(--kw-fg)/80">
            Join Knoww and get real-time prediction markets wherever the
            internet debates what happens next.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={chromeStoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2.5 bg-(--kw-fg) px-7 py-4 text-[14px] font-semibold text-(--kw-bg) transition-colors hover:bg-(--kw-fg)/90"
            >
              Get Early Access
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href={chromeStoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 border-b border-(--kw-fg)/20 px-5 py-4 text-[14px] font-medium text-(--kw-fg)/70 transition-colors hover:border-(--kw-fg) hover:text-(--kw-fg)"
            >
              <Activity className="h-4 w-4" />
              Install Extension Soon
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
