# Web Client-Bundle Performance Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the JS and font payload that every page of `apps/web` ships — defer the Reown AppKit wallet-modal stack until first connect intent, convert the landing page to server components with small client islands, and collapse ~15 static font files into 3 variable fonts.

**Architecture:** Three independent changes. (1) `createAppKit` moves from module scope of the root provider into a lazily-imported singleton (`src/lib/wallet-modal.ts`) invoked from the 7 call sites that open/close the modal; `WagmiProvider` and the wagmi config stay eager so account state, SSR cookie hydration, and session restore are untouched. (2) The landing page inverts from one big `"use client"` tree to a server `page.tsx` rendering static sections, with client islands only for theme state, cursor glow, the hero artifact, and the two interval-driven mock widgets. (3) `layout.tsx` switches Plus Jakarta Sans, Geist, and Geist Mono to their variable forms (single file each, same weight coverage — zero visual change); Fraunces and JetBrains Mono are already minimal and stay untouched.

**Tech Stack:** Next.js 15 App Router (React Server Components), @reown/appkit + @reown/appkit-adapter-wagmi + wagmi v2, next/font/google, vitest (jsdom, globals on), biome, pnpm. Deployed via @opennextjs/cloudflare; bundle measurement uses plain `next build`.

**Verification baseline:** Task 1 records the production route table BEFORE any change; Task 5 re-measures and verifies behavior live with chrome-devtools against `next start`.

> **IMPORTANT — no git commits.** The repo owner commits manually. Never run `git add` or `git commit`. Leave all changes uncommitted. Where a normal TDD loop would say "commit", just move on.

> **IMPORTANT — verbatim code moves.** Tasks 4 moves existing code blocks between files. The source contains typographic Unicode (curly quotes, cent signs, numero signs) that MUST NOT be retyped by hand. Always move blocks by copying from the source file (read the file, cut the exact line ranges) — never re-transcribe them.

**Commands cheat-sheet** (run from `apps/web/`):
- Typecheck: `pnpm typecheck` · Lint: `pnpm lint` · Tests: `pnpm vitest run src/lib/`
- Production build: `pnpm exec next build` · Production server: `pnpm exec next start --port 8000`

---

### Task 1: Baseline production bundle measurement

**Files:**
- Create: `tmp/bundle-baseline.txt` (repo-root tmp/, untracked scratch — not committed)

- [ ] **Step 1: Build and capture the route table**

Run from `apps/web/`:

```bash
pnpm exec next build 2>&1 | tee /Users/nareshkatta/Desktop/Soclly/polycaster/tmp/bundle-baseline.txt
```

Expected: build succeeds (env comes from the same `.env*` files `next dev` already uses — the dev server ran fine on 2026-06-10, so `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is present). The output ends with the route table listing per-route "Size" and "First Load JS" plus the shared chunk total.

If the build fails on a missing env var, report BLOCKED with the exact error — do not invent env values.

- [ ] **Step 2: Record the three numbers that matter**

From the table, note in your report: (a) `/` First Load JS, (b) the "First Load JS shared by all" total, (c) `/markets` First Load JS. These are the before-numbers Task 5 compares against.

---

### Task 2: Variable fonts in the root layout

**Files:**
- Modify: `apps/web/src/app/layout.tsx:18-57`

Background: the layout loads Plus Jakarta Sans with 7 explicit weights, Geist with 5, and Geist Mono with 3 — each explicit weight is a separate static woff2 file. All three families are variable fonts on Google Fonts whose weight axes cover every weight currently loaded (Plus Jakarta Sans 200–800, Geist 100–900, Geist Mono 100–900). With `next/font/google`, omitting `weight` selects the variable font: one file per family, identical rendering at every weight. JetBrains Mono already has no `weight` (already variable). Fraunces is already trimmed to 4 files and is the visual identity of the hero — leave it untouched.

- [ ] **Step 1: Replace the three font constructors**

In `apps/web/src/app/layout.tsx`, change:

```ts
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600", "700", "800"],
});
```

to:

```ts
// Variable font — one file covers the full 200-800 weight axis (the
// explicit-weight form downloaded seven separate files for the same range).
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});
```

Change:

```ts
const geistSans = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});
```

to:

```ts
const geistSans = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});
```

Leave `jetbrainsMono` and `fraunces` exactly as they are. Do not touch anything else in the file.

- [ ] **Step 2: Verify**

Run: `pnpm typecheck` — clean. `pnpm biome check src/app/layout.tsx` — clean.

Run `pnpm dev` briefly (or rely on Task 5's production pass): load `http://localhost:8000/markets`, and in the browser console run:

```js
getComputedStyle(document.querySelector("h1, h2, .font-bold")).fontWeight
```

Expected: bold elements still report 700 (the variable font serves it). Stop the dev server afterwards. (Full visual verification happens in Task 5.)

---

### Task 3: Lazy AppKit initialization

**Files:**
- Create: `apps/web/src/lib/wallet-modal.ts`
- Create: `apps/web/src/lib/wallet-modal.test.ts`
- Modify: `apps/web/src/context/index.tsx` (remove module-scope `createAppKit`)
- Modify (call sites): `apps/web/src/context/wallet-context.tsx:3,72-85`, `apps/web/src/components/navbar.tsx:3,34,104`, `apps/web/src/components/top-nav.tsx:3,62,129`, `apps/web/src/components/sidebar-mobile.tsx:3,52,219`, `apps/web/src/app/portfolio/page.tsx:3,51,393`, `apps/web/src/components/trading-onboarding.tsx:6,129,290`, `apps/web/src/components/trading-form.tsx:4,144,724`

Background: `createAppKit` currently runs at module evaluation of `src/context/index.tsx`, which the root layout imports — so the entire Reown modal UI boots on every page load. Audit confirmed the ONLY AppKit API used anywhere is `useAppKit().open` (7 files) and `useAppKit().close` (wallet-context only); account state everywhere comes from wagmi hooks, which work off `wagmiAdapter.wagmiConfig` independently of `createAppKit`. So the modal can initialize on first connect/disconnect intent. `WagmiProvider`, cookie SSR state, and session restore (wagmi `reconnectOnMount` + the connectors baked into the adapter config) are unaffected.

NOTE on semantics: `wallet-context.tsx`'s `disconnect` callback calls AppKit `close()` (which closes the modal — a pre-existing naming oddity). Preserve that behavior exactly; do NOT "fix" it to a real wallet disconnect.

This task must land atomically: removing `createAppKit` from the context while any `useAppKit()` call remains would type-check but throw at runtime ("Please call createAppKit before using hooks"). The final state must have ZERO imports of `@reown/appkit/react` outside `src/lib/wallet-modal.ts` (type-only import there).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/wallet-modal.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.fn(async () => undefined);
const close = vi.fn(async () => undefined);
const createAppKit = vi.fn(() => ({ open, close }));

vi.mock("@reown/appkit/react", () => ({ createAppKit }));
vi.mock("@/config", () => ({
  networks: [{ id: 137 }],
  projectId: "test-project-id",
  wagmiAdapter: { wagmiConfig: {} },
}));
vi.mock("@/lib/chains", () => ({ polygon: { id: 137 } }));

import { closeWalletModal, openWalletModal } from "./wallet-modal";

describe("wallet-modal", () => {
  beforeEach(() => {
    createAppKit.mockClear();
    open.mockClear();
    close.mockClear();
  });

  it("initializes AppKit once across multiple opens", async () => {
    await openWalletModal();
    await openWalletModal();
    expect(createAppKit).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("close before any open does not boot AppKit", async () => {
    await closeWalletModal();
    expect(createAppKit).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("close after open closes the modal", async () => {
    await openWalletModal();
    await closeWalletModal();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
```

NOTE: test order matters within the file only in that the singleton persists across tests — the "close before any open" test MUST run against a fresh module or before any open. The simplest correct structure: keep the test order exactly as written above BUT make the first `it` the close-before-open test. Rewrite the describe body so the order is: (1) "close before any open does not boot AppKit", (2) "initializes AppKit once across multiple opens", (3) "close after open closes the modal". (The mockClear in beforeEach resets call counts but not the module's memoized singleton — that's fine for this order.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/wallet-modal.test.ts`
Expected: FAIL — module `./wallet-modal` does not exist.

- [ ] **Step 3: Create the lazy modal module**

Create `apps/web/src/lib/wallet-modal.ts`:

```ts
import { createLogger } from "@knoww/logger";

const log = createLogger("wallet-modal");

let modalPromise: ReturnType<typeof initAppKit> | null = null;

function getAppUrl(): string {
  if (typeof window === "undefined") {
    return "https://knoww.app";
  }
  return window.location.origin;
}

async function initAppKit() {
  const [{ createAppKit }, { networks, projectId, wagmiAdapter }, { polygon }] =
    await Promise.all([
      import("@reown/appkit/react"),
      import("@/config"),
      import("@/lib/chains"),
    ]);

  if (!projectId) {
    throw new Error("Project ID is not defined in wallet-modal");
  }

  return createAppKit({
    adapters: [wagmiAdapter],
    projectId,
    networks,
    defaultNetwork: polygon, // Polymarket trades on Polygon
    allowUnsupportedChain: true,
    metadata: {
      name: "Knoww",
      description: "A prediction market layer for the open internet.",
      url: getAppUrl(), // origin must match the active domain and subdomain
      icons: ["https://avatars.githubusercontent.com/u/179229932"],
    },
    features: {
      analytics: true,
      emailShowWallets: true, // Show other wallets alongside email
    },
  });
}

/**
 * createAppKit boots the whole Reown UI stack (web components, modal views,
 * walletconnect core). At module scope that lands in the shared bundle and
 * executes on every page load; behind this memoized dynamic import only a
 * user's explicit connect/disconnect intent pays the cost. Wagmi account
 * state and session restore do not depend on this — they live on
 * wagmiAdapter.wagmiConfig, which stays eagerly constructed in @/config.
 */
function getModal(): ReturnType<typeof initAppKit> {
  if (!modalPromise) {
    modalPromise = initAppKit().catch((error) => {
      modalPromise = null; // allow retry after a failed chunk load
      throw error;
    });
  }
  return modalPromise;
}

/** Open the wallet-connect modal, initializing AppKit on first call. */
export async function openWalletModal(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const modal = await getModal();
    await modal.open();
  } catch (error) {
    log.error("open_failed", { error });
  }
}

/**
 * Close the wallet modal. Intentionally a no-op when AppKit was never
 * initialized — booting the whole stack just to close nothing is wasted work.
 */
export async function closeWalletModal(): Promise<void> {
  if (typeof window === "undefined" || !modalPromise) return;
  try {
    const modal = await getModal();
    await modal.close();
  } catch (error) {
    log.error("close_failed", { error });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/wallet-modal.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Strip createAppKit from the root provider**

In `apps/web/src/context/index.tsx`, delete:
- the `createAppKit` import (line 3) and the `polygon` import from `@/lib/chains` (line 15 — only used by createAppKit),
- the `projectId`/`networks` pieces of the `@/config` import (keep `wagmiAdapter`),
- the `if (!projectId) { throw ... }` block (lines 44-46) — the same guard already exists in `@/config` at import time,
- `getAppUrl()` (lines 48-54), the `metadata` object (lines 56-62), and the entire `const _modal = createAppKit({...})` block (lines 64-78).

After the edit, the file's imports from config/chains are exactly: `import { wagmiAdapter } from "@/config";` and nothing from `@/lib/chains`. Everything from `function ContextProvider` down is unchanged.

- [ ] **Step 6: Rewrite the 7 call sites**

The mechanical transformation for each file: delete the `import { useAppKit } from "@reown/appkit/react";` line, delete the `const { open } = useAppKit();` line, add `import { openWalletModal } from "@/lib/wallet-modal";` (biome will sort it), and change the call:

- `apps/web/src/components/navbar.tsx`: line 104 `open();` becomes `void openWalletModal();`
- `apps/web/src/components/top-nav.tsx`: line 129 `onClick={() => open()}` becomes `onClick={() => void openWalletModal()}`
- `apps/web/src/components/sidebar-mobile.tsx`: line 219 `open();` becomes `void openWalletModal();`
- `apps/web/src/app/portfolio/page.tsx`: line 393 `onClick={() => open()}` becomes `onClick={() => void openWalletModal()}`
- `apps/web/src/components/trading-onboarding.tsx`: line 290 `await open();` becomes `await openWalletModal();`
- `apps/web/src/components/trading-form.tsx`: line 724 `onClick={() => open()}` becomes `onClick={() => void openWalletModal()}`

`apps/web/src/context/wallet-context.tsx` is the only two-function site. Delete its `useAppKit` import and the `const { open, close } = useAppKit();` line (72), import both helpers (`import { closeWalletModal, openWalletModal } from "@/lib/wallet-modal";`), and change the two callbacks (lines 77-85) to:

```ts
  // Connect wallet via AppKit modal (lazily initialized on first use)
  const connect = useCallback(() => {
    void openWalletModal();
  }, []);

  // Close the AppKit modal (pre-existing behavior of this "disconnect" hook)
  const disconnect = useCallback(async () => {
    await closeWalletModal();
  }, []);
```

- [ ] **Step 7: Verify no eager AppKit imports remain**

Run:

```bash
grep -rn "@reown/appkit/react" src --include="*.ts" --include="*.tsx"
```

Expected: exactly ONE hit — the dynamic `import("@reown/appkit/react")` inside `src/lib/wallet-modal.ts`. Then:

```bash
pnpm typecheck && pnpm lint && pnpm vitest run src/lib/
```

Expected: all clean/green (typecheck will catch any missed `open()` reference).

---

### Task 4: Landing page server/client split

**Files:**
- Create: `apps/web/src/components/landing/knoww-sections-live.tsx` (client islands: the two interval widgets)
- Create: `apps/web/src/components/landing/landing-shell.tsx` (client: theme root + cursor glow)
- Create: `apps/web/src/components/landing/landing-theme-dropdown.tsx` (client: header dropdown island)
- Modify: `apps/web/src/components/landing/knoww-sections.tsx` (becomes a server module)
- Rewrite: `apps/web/src/app/page.tsx` (server page owning all static markup)
- Delete: `apps/web/src/app/landing-page-client.tsx`

Background (from code audit): the entire landing tree is client today only because the top component calls `useKwTheme()` (theme data-attributes on the root div) and renders `CursorGlow`. The 1,005-line `knoww-sections.tsx` uses exactly two client hooks: `useTickingOdds` (line 50, used only by `ExtensionPopup`, line 270) and `useTickingNumber` (line 548, used only by `AgentDashboard`, line 575, with its `AGENT_BULLETS` const at 566). `TickerBar` is pure CSS animation (no JS state). `TweetOverlayHero`, `CursorGlow`, `KwThemeDropdown` are already self-contained `"use client"` components — rendered from a server page they become islands automatically. Inverting the structure makes everything except those islands zero-hydration server markup.

REMINDER: move code by copy, never retype — the sections contain curly quotes, cent signs, and numero signs that must survive byte-for-byte.

- [ ] **Step 1: Create the live-widgets island file**

Create `apps/web/src/components/landing/knoww-sections-live.tsx` with this exact header:

```tsx
"use client";

/**
 * The only client-side pieces of the landing sections: two mock widgets
 * whose numbers drift on an interval for the "live" feel. Everything else
 * in knoww-sections.tsx is static server markup; keeping these isolated
 * means the sections ship zero hydration JS apart from these two islands.
 */

import { useEffect, useState } from "react";
```

Then MOVE (cut from `knoww-sections.tsx`, paste here verbatim) these four blocks, in this order:
1. `useTickingOdds` — `knoww-sections.tsx` lines 48-65 (the doc comment line starting `/** Odds value that drifts` plus the whole function).
2. `ExtensionPopup` — the whole function starting at line 270 (everything up to but not including `export function ExtensionSection()` at line 331), including any comment block directly above it.
3. `useTickingNumber` — the whole function at lines 548-564, including its preceding comment if any.
4. `AGENT_BULLETS` const (lines 566-573) and the whole `AgentDashboard` function (line 575 up to but not including `export function AgentSection()` at line 698).

Make `ExtensionPopup` and `AgentDashboard` exported (`export function ...`). Then add the lucide-react icon import this file needs: check which icons the moved code references (at minimum `TrendingUp`, `Bell`, `Search`, `Sparkles`, `Wallet`, `Eye` from AGENT_BULLETS, plus whatever `ExtensionPopup`/`AgentDashboard` JSX uses) and import exactly those from `"lucide-react"`. Run `pnpm typecheck` — it will name any icon you missed; `pnpm lint` will name any you over-imported.

- [ ] **Step 2: Make knoww-sections.tsx a server module**

In `apps/web/src/components/landing/knoww-sections.tsx`:
- Delete the `"use client";` directive (line 1).
- Add `import { AgentDashboard, ExtensionPopup } from "./knoww-sections-live";` (the JSX at old lines 371 and 734 keeps working unchanged — a server component rendering client components is exactly the island pattern we want).
- Fix the react import: `useEffect` and `useState` moved out with the hooks; keep `type ReactNode` if still referenced (it is — `FeatureCard` props). The import becomes `import type { ReactNode } from "react";`.
- Remove any lucide-react icons from the import list that only the moved code used (typecheck + biome will pinpoint them — icons used by remaining sections stay).

Run: `pnpm typecheck` — clean before proceeding.

- [ ] **Step 3: Create the landing shell (client)**

Create `apps/web/src/components/landing/landing-shell.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { CursorGlow } from "@/components/cursor-glow";
import { KW_PAGE_CLASS, useKwTheme } from "@/components/kw-theme";

/**
 * Client shell for the landing page: owns the next-themes-driven theme
 * attributes on the page root and the pointer-tracking glow. Everything
 * passed as children stays server-rendered — keep this file free of any
 * content markup so the sections never get pulled back into client JS.
 */
export function LandingShell({ children }: { children: ReactNode }) {
  const { colorScheme, theme } = useKwTheme();

  return (
    <div
      className={`${KW_PAGE_CLASS} kw-landing fixed inset-0 z-60 overflow-x-hidden overflow-y-auto bg-(--kw-bg) text-(--kw-fg) font-sans`}
      data-theme={theme}
      data-scheme={colorScheme}
      style={{ colorScheme }}
    >
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:bg-(--kw-fg) focus:text-(--kw-bg) focus:px-4 focus:py-2 focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>
      <CursorGlow />
      {children}
    </div>
  );
}
```

(The root div className, data attributes, and skip link are copied from the current `landing-page-client.tsx:44-55` — verify against the source, byte-identical.)

- [ ] **Step 4: Create the theme dropdown island**

Create `apps/web/src/components/landing/landing-theme-dropdown.tsx`:

```tsx
"use client";

import { KwThemeDropdown, useKwTheme } from "@/components/kw-theme";

/**
 * Self-contained island so the server-rendered landing header can mount the
 * theme picker without dragging the whole header into client JS. Shares
 * next-themes state with LandingShell, so both hook instances stay in sync.
 */
export function LandingThemeDropdown() {
  const { setTheme, theme } = useKwTheme();
  return <KwThemeDropdown theme={theme} onThemeChange={setTheme} />;
}
```

- [ ] **Step 5: Rewrite page.tsx as the server page**

Rewrite `apps/web/src/app/page.tsx` by MOVING the content of `landing-page-client.tsx` into it (copy, don't retype):

- Keep the existing `metadata` export and its imports exactly as they are in `page.tsx` today.
- NO `"use client"` directive.
- Imports: everything `landing-page-client.tsx` imports EXCEPT `CursorGlow`, `useKwTheme`, and `KwThemeDropdown`/`KW_PAGE_CLASS` (now owned by the shell/island files); PLUS `import { LandingShell } from "@/components/landing/landing-shell";` and `import { LandingThemeDropdown } from "@/components/landing/landing-theme-dropdown";`.
- Move the `CHROME_STORE_URL` and `TICKER` consts and the whole `TickerBar` function over verbatim.
- The default export becomes:

```tsx
export default function LandingPage() {
  return (
    <LandingShell>
      <TickerBar />
      {/* header, main, footer — moved verbatim from landing-page-client.tsx */}
    </LandingShell>
  );
}
```

where the comment stands for the verbatim `<header>...</header>`, `<main id="content" ...>...</main>`, and `<footer>...</footer>` blocks from `landing-page-client.tsx:59-315`, with exactly ONE change inside them: in the header (old line 101), `<KwThemeDropdown theme={theme} onThemeChange={setTheme} />` becomes `<LandingThemeDropdown />`. The root div, skip link, and `CursorGlow` do NOT move — the shell renders them. The `useKwTheme()` destructuring line is dropped entirely (nothing else referenced `theme`/`setTheme`/`colorScheme` — verify with a search inside the moved markup before deleting; if anything else references them, STOP and report DONE_WITH_CONCERNS).

- Delete `apps/web/src/app/landing-page-client.tsx` (its only importer was page.tsx — verified by grep).

- [ ] **Step 6: Verify the split**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run src/lib/
grep -rn "use client" src/components/landing/knoww-sections.tsx
```

Expected: all green; the grep returns NOTHING (sections are server). Then confirm the island boundaries:

```bash
grep -c "use client" src/components/landing/knoww-sections-live.tsx src/components/landing/landing-shell.tsx src/components/landing/landing-theme-dropdown.tsx
```

Expected: 1 each. Behavioral verification (theme toggle, tickers, hydration) happens in Task 5 against the production build.

---

### Task 5: Re-measure and verify live with chrome-devtools

**Files:**
- Create: `tmp/bundle-after.txt` (scratch, untracked)

- [ ] **Step 1: Full static gate**

Run from `apps/web/`: `pnpm typecheck && pnpm lint && pnpm test`
Expected: typecheck clean; biome 0 errors (19 pre-existing globals.css warnings are known); full vitest + node suites green including the 3 new wallet-modal tests.

- [ ] **Step 2: Rebuild and compare**

```bash
pnpm exec next build 2>&1 | tee /Users/nareshkatta/Desktop/Soclly/polycaster/tmp/bundle-after.txt
```

Compare against `tmp/bundle-baseline.txt`: report the deltas for `/` First Load JS, shared First Load JS, and `/markets` First Load JS. Expected direction: all three shrink (the shared chunk loses the AppKit modal UI; `/` additionally loses the sections' hydration JS). If any number GREW, investigate before proceeding — likely an accidental eager import.

- [ ] **Step 3: Start the production server**

```bash
pnpm exec next start --port 8000
```

(run in background; confirm `curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/` returns 200).

- [ ] **Step 4: chrome-devtools checklist**

Using the chrome-devtools MCP tools:

1. **Landing renders fully (server markup intact):** navigate to `http://localhost:8000/`, `wait_for` the texts "Every", "How it works", and "Made for the prediction-literate" (footer) — all present. Take a snapshot and spot-check the section headings exist (Problem, How it works, Use cases, Traction).
2. **No hydration errors:** `list_console_messages` types error/warn — there must be no React hydration-mismatch errors (pre-existing third-party warnings are acceptable; anything mentioning "hydra" or "did not match" is a failure).
3. **Theme toggle island works:** click the theme dropdown in the header, pick the dark option, and verify via `evaluate_script` that the page root's `data-theme` attribute changed (the shell and the dropdown share next-themes state — this proves the two islands are wired).
4. **Live widgets tick:** `evaluate_script` reading the ExtensionPopup odds text twice ~2.5s apart (use two calls) — values should differ (interval island hydrated). If `prefers-reduced-motion` is set in the test browser they won't tick; check that media query first and skip if so.
5. **Font payload:** `list_network_requests` filtered to font — count woff2 requests on `/`. Expected: meaningfully fewer than baseline (was ~15 files configured; now Plus Jakarta Sans, Geist, Geist Mono are 1 file each + JetBrains 1 + Fraunces 4). Also `evaluate_script`: `getComputedStyle(document.querySelector(".font-bold")).fontWeight` → "700".
6. **AppKit is lazy:** open a NEW page to `http://localhost:8000/markets`, confirm via `list_network_requests` that no chunk containing appkit/walletconnect modal UI loaded on page load (look at script requests), then click the Connect/wallet button in the navbar. Expected: a new script chunk request fires AFTER the click, and `evaluate_script` `!!document.querySelector("w3m-modal, appkit-modal")` returns true (modal web component mounted). Close the modal.
7. **Wallet state intact:** on `/markets`, `list_console_messages` — no errors from wagmi/context (the WagmiProvider path untouched; this is a regression tripwire).

- [ ] **Step 5: Stop the server and report**

Stop the `next start` background process. Report: the three bundle deltas, font request delta, and the 7 checklist results. Leave all changes uncommitted.

---

## Out of scope (candidates for plan 3)

framer-motion LazyMotion conversion (30+ files), home-grid virtualization with `virtua`, polling-interval alignment with edge-cache TTLs, `useNow()` ticker extraction, and the `use-user-positions` duplicate-poll consolidation. Also the dead `verifyExtensionAccess` cleanup flagged in plan 1's final review.

## Self-review notes

- **Spec coverage:** review findings #3 (AppKit module-scope init) → Task 3; #13 (client landing page) → Task 4; #12 (font payload) → Task 2; measurement demanded by all three → Tasks 1 + 5.
- **Risk register:** Task 3's atomicity requirement is stated (runtime-throw window between context strip and call-site rewrite); Task 4's verbatim-move rule guards the Unicode content; Task 2 is reversible by restoring the weight arrays.
- **Type consistency:** `openWalletModal`/`closeWalletModal` names used identically in Task 3 Steps 1/3/6; `LandingShell`/`LandingThemeDropdown`/`ExtensionPopup`/`AgentDashboard` names consistent across Task 4 steps.
