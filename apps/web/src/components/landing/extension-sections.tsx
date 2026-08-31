import {
  Cpu,
  Download,
  Eye,
  Layers,
  Lock,
  PanelRight,
  Pin,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import extensionManifest from "../../../../extension/manifest.json";
import { PLATFORMS, SECTION, SectionLabel } from "./knoww-sections";
import { ExtensionPopup } from "./knoww-sections-live";
import { CHROME_STORE_URL } from "./landing-chrome";

/** Sourced from apps/extension/manifest.json at build time so it never
 * drifts from the shipped extension. */
export const EXTENSION_VERSION: string = extensionManifest.version;

/* ------------------------------------------------------------------ */
/* 02 — Supported sites                                               */
/* ------------------------------------------------------------------ */

export function SupportedSitesSection() {
  return (
    <section id="sites" className="bg-(--kw-bg-alt)">
      <div className={SECTION}>
        <SectionLabel n="02" label="Supported sites" />
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
          <div className="kw-reveal">
            <h2 className="text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl">
              Works where the internet argues.
            </h2>
            <p className="mt-6 max-w-[52ch] text-base leading-[1.6] text-(--kw-fg)/80">
              The Knoww prediction market browser extension runs on the places
              debates actually happen — X, Reddit, Hacker News, and major news,
              finance, and crypto media.
            </p>
            <p className="mt-4 max-w-[52ch] text-base leading-[1.6] text-(--kw-fg)/80">
              Host access is limited to supported sites: the extension cannot
              see anything else you browse.{" "}
              <span className="text-(--kw-fg)">
                The full, current list lives in the extension settings.
              </span>
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
/* 03 — How matching works                                            */
/* ------------------------------------------------------------------ */

const MATCHING_STEPS = [
  {
    n: "01",
    title: "Read",
    body: "The extension reads the visible text of the post or article you’re viewing, in your browser.",
  },
  {
    n: "02",
    title: "Match",
    body: "A small on-device embedding model compares it against Polymarket markets and ranks the closest matches. By default, nothing is sent to a server for matching.",
  },
  {
    n: "03",
    title: "Surface",
    body: "When there’s a confident match, live odds are fetched from Polymarket and appear inline, right on the page.",
  },
  {
    n: "04",
    title: "Decide",
    body: "Open the market, track it, or take a position. If you trade, you review and sign every transaction yourself.",
  },
];

export function MatchingSection() {
  return (
    <section id="how">
      <div className={SECTION}>
        <SectionLabel n="03" label="How matching works" />
        <h2 className="kw-reveal text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl">
          How matching works.
        </h2>
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {MATCHING_STEPS.map((s) => (
            <div
              key={s.n}
              className="kw-reveal rounded-[16px] border border-(--kw-fg)/10 bg-(--kw-fg)/2 p-6"
            >
              <div className="font-mono text-[12px] text-(--kw-accent-text)">
                {s.n}
              </div>
              <div className="mt-3 text-[17px] font-semibold">{s.title}</div>
              <p className="mt-2 text-[14px] leading-[1.6] text-(--kw-fg)/75">
                {s.body}
              </p>
            </div>
          ))}
        </div>
        <p className="kw-reveal mt-8 max-w-[72ch] text-[14px] leading-[1.6] text-(--kw-fg)/65">
          An optional AI-assisted mode can send short, truncated text excerpts
          to Knoww APIs for better topic extraction. You control it from the
          extension settings, where you can also turn off usage analytics.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 04 — Permissions & privacy                                         */
/* ------------------------------------------------------------------ */

const PERMISSIONS = [
  {
    icon: Layers,
    name: "storage",
    why: "Keeps your settings and cached matches in your browser.",
  },
  {
    icon: Eye,
    name: "scripting",
    why: "Injects the odds overlay into supported pages.",
  },
  {
    icon: Cpu,
    name: "offscreen",
    why: "Runs the local matching model in the background.",
  },
  {
    icon: PanelRight,
    name: "sidePanel",
    why: "Shows the market side panel next to the page.",
  },
];

export function PermissionsSection() {
  return (
    <section id="privacy" className="bg-(--kw-bg-alt)">
      <div className={SECTION}>
        <SectionLabel n="04" label="Permissions & privacy" />
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="kw-reveal">
            <h2 className="text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl">
              Permissions, and why we ask.
            </h2>
            <p className="mt-6 max-w-[52ch] text-base leading-[1.6] text-(--kw-fg)/80">
              The extension asks for exactly four Chrome API permissions. Host
              access lets matching run on supported sites and lets a lightweight
              request prompt appear elsewhere.
            </p>
            <p className="mt-4 max-w-[52ch] text-base leading-[1.6] text-(--kw-fg)/80">
              What stays in your browser: page text and matching (by default),
              your settings, and local caches. On unsupported sites, the prompt
              reads only the current domain; it does not inspect page content.
              What reaches knoww.app: market lookups, usage events while
              analytics is enabled, and text excerpts only if you turn on
              AI-assisted matching. You can turn analytics off in settings.
            </p>
            <Link
              href="/privacy"
              className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-(--kw-accent-text) transition-colors hover:text-(--kw-fg)"
            >
              Read the full privacy policy
            </Link>
          </div>
          <ul className="space-y-4">
            {PERMISSIONS.map((p) => (
              <li
                key={p.name}
                className="kw-reveal flex items-start gap-4 rounded-[14px] border border-(--kw-fg)/10 bg-(--kw-fg)/2 p-5"
              >
                <p.icon className="mt-0.5 h-4.5 w-4.5 shrink-0 text-(--kw-accent-text)" />
                <div>
                  <div className="font-mono text-[13px] text-(--kw-fg)">
                    {p.name}
                  </div>
                  <p className="mt-1 text-[14px] leading-[1.55] text-(--kw-fg)/75">
                    {p.why}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 05 — Trading, accurately                                           */
/* ------------------------------------------------------------------ */

export function TradingSection() {
  return (
    <section id="trading">
      <div className={SECTION}>
        <SectionLabel n="05" label="Trading" />
        <div className="kw-reveal max-w-[760px]">
          <h2 className="text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl">
            If you want to act on it.
          </h2>
          <p className="mt-6 text-base leading-[1.6] text-(--kw-fg)/80">
            Seeing the odds is free and needs no account or wallet. If you
            decide to trade, Knoww is non-custodial: you connect your own
            wallet, hold your own funds, and review and sign every transaction
            before it is placed. Nothing trades on your behalf.
          </p>
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-[13px] font-mono uppercase tracking-[0.12em] text-(--kw-fg)/70">
            <span className="inline-flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-(--kw-accent-text)" />
              Non-custodial
            </span>
            <span className="inline-flex items-center gap-2">
              <Wallet className="h-3.5 w-3.5 text-(--kw-accent-text)" />
              Your own wallet
            </span>
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-(--kw-accent-text)" />
              You sign every transaction
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 06 — Install                                                       */
/* ------------------------------------------------------------------ */

const INSTALL_STEPS = [
  {
    n: "01",
    icon: Download,
    title: "Add to Chrome",
    body: "Install from the Chrome Web Store — free, one click of Chrome’s own install button.",
  },
  {
    n: "02",
    icon: Pin,
    title: "Pin the icon",
    body: "Pin Knoww from the puzzle-piece menu so settings stay one click away.",
  },
  {
    n: "03",
    icon: Eye,
    title: "Browse",
    body: "Read like you normally do. When a page matches a market, live prediction-market odds appear.",
  },
];

export function InstallSection() {
  return (
    <section id="install" className="bg-(--kw-bg-alt)">
      <div className={SECTION}>
        <SectionLabel n="06" label="Install" />
        <h2 className="kw-reveal text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl">
          Install in under a minute.
        </h2>
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {INSTALL_STEPS.map((s) => (
            <div
              key={s.n}
              className="kw-reveal rounded-[16px] border border-(--kw-fg)/10 bg-(--kw-fg)/2 p-6"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[12px] text-(--kw-accent-text)">
                  {s.n}
                </span>
                <s.icon className="h-4 w-4 text-(--kw-fg)/50" />
              </div>
              <div className="mt-3 text-[17px] font-semibold">{s.title}</div>
              <p className="mt-2 text-[14px] leading-[1.6] text-(--kw-fg)/75">
                {s.body}
              </p>
            </div>
          ))}
        </div>
        <div className="kw-reveal mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 bg-(--kw-fg) px-7 py-4 text-[14px] font-semibold text-(--kw-bg) transition-colors hover:bg-(--kw-fg)/90"
          >
            <Download className="h-4 w-4" />
            Add to Chrome — Free
          </a>
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[12px] uppercase tracking-[0.12em] text-(--kw-fg)/60 transition-colors hover:text-(--kw-fg)"
          >
            Version {EXTENSION_VERSION} — see what’s new
          </a>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 07 — FAQ                                                           */
/* ------------------------------------------------------------------ */

const FAQ: Array<{ q: string; a: ReactNode }> = [
  {
    q: "Is the extension free?",
    a: "Yes. Discovery and live odds are free. If you choose to trade, you use your own funds.",
  },
  {
    q: "Which browsers are supported?",
    a: "Chrome, plus Chromium-based browsers that install from the Chrome Web Store — Brave, Edge, and Arc.",
  },
  {
    q: "Does Knoww read my browsing history?",
    a: "No. Full page matching runs only on supported sites. On other sites, a lightweight request prompt sees only the current domain and does not inspect page content. Usage analytics records feature events and the current domain, not page addresses or page text, and you can turn it off in settings.",
  },
  {
    q: "Do I need an account or a wallet?",
    a: "Not to see odds — discovery works with nothing connected. Trading requires connecting a wallet.",
  },
  {
    q: "Where do the odds come from?",
    a: "Polymarket — live prediction-market prices from real trading, not editorial estimates.",
  },
  {
    q: "What data does Knoww collect?",
    a: (
      <>
        Settings and caches stay in your browser; optional features are off by
        default. See the{" "}
        <Link href="/privacy" className="underline hover:text-(--kw-fg)">
          privacy policy
        </Link>{" "}
        for the complete picture.
      </>
    ),
  },
];

export function FaqSection() {
  return (
    <section id="faq">
      <div className={SECTION}>
        <SectionLabel n="07" label="FAQ" />
        <h2 className="kw-reveal text-3xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl">
          Frequently asked questions.
        </h2>
        <dl className="mt-12 grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q} className="kw-reveal">
              <dt className="text-[16px] font-semibold">{item.q}</dt>
              <dd className="mt-2 max-w-[52ch] text-[14px] leading-[1.6] text-(--kw-fg)/75">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
