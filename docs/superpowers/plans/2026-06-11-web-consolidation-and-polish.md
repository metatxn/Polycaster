# Web Consolidation & Polish Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the remaining web-side review findings that don't require infrastructure decisions: connect-button UX polish, dead-code removal, theme FOUC, LazyMotion, render-cost wins, polling alignment, the two slow API routes, and the quality/duplication consolidation (formatters, fetch helper, error envelope, zod query schemas, query-key adoption).

**Architecture:** Mostly consolidation: new small shared modules in `src/lib/` and `src/hooks/` plus mechanical migration of call sites discovered by grep at execution time. Two UX changes (pending state on connect buttons, adaptive cents) are deliberate behavior improvements approved by the owner. No god-file splits here — that is plan 4, written after this plan lands (these migrations shrink those files first).

**Tech Stack:** Next.js 15 App Router on Cloudflare Workers, TanStack Query + `qk` factory, framer-motion → LazyMotion(`m`), decimal.js, vitest (jsdom, globals), biome, pnpm.

**Decisions made with the owner (2026-06-11):** god-file splits deferred to plan 4; shared rate-limit store DEFERRED (keep per-isolate limiter); cents display = adaptive ("75¢" when whole, "75.3¢" when fractional — never round away available precision; this is a financial app).

> **IMPORTANT — no git commits.** The repo owner commits manually. Never run `git add`/`git commit`.

> **Migration tasks use grep-enumeration:** for repetitive many-file migrations the plan specifies the exact transformation rule + one worked example + the grep that enumerates the sites. The executor applies the rule to every hit and reports the count. Verification gates (typecheck, biome, grep-zero) make missed sites impossible to ship silently.

**Commands** (from `apps/web/`): test `pnpm vitest run src/lib/`, typecheck `pnpm typecheck`, lint `pnpm lint`, build `pnpm exec next build`.

---

### Task 1: Connect-button UX — strict open variant, pending state, preload everywhere

**Files:**
- Modify: `apps/web/src/lib/wallet-modal.ts` (add `openWalletModalStrict`)
- Modify: `apps/web/src/lib/wallet-modal.test.ts` (add 1 test)
- Modify: `apps/web/src/components/trading-onboarding.tsx:286-295` (use strict variant)
- Modify: `apps/web/src/components/top-nav.tsx:~128`, `apps/web/src/components/sidebar-mobile.tsx:~218`, `apps/web/src/app/portfolio/page.tsx:~392` (preload + pending)
- Modify: `apps/web/src/components/navbar.tsx:~99-110`, `apps/web/src/components/trading-form.tsx:~720-727` (pending state; preload already wired)

Background: `openWalletModal` never rejects (it logs internally), so trading-onboarding's catch that sets the connect step to "error" is unreachable; and on a cold first click (dev compile / prod chunk download) buttons give zero feedback.

- [ ] **Step 1: Failing test for the strict variant**

Append to `apps/web/src/lib/wallet-modal.test.ts` (inside the main describe, after the existing tests — note the file's singleton-order comment still holds; this test runs with the singleton already booted, which is fine because we only assert rejection propagation):

```ts
  it("openWalletModalStrict rejects when the modal open fails", async () => {
    open.mockRejectedValueOnce(new Error("boom"));
    await expect(openWalletModalStrict()).rejects.toThrow("boom");
  });
```

and add `openWalletModalStrict` to the import from `./wallet-modal`.

Run: `pnpm vitest run src/lib/wallet-modal.test.ts` — FAIL (no such export).

- [ ] **Step 2: Implement `openWalletModalStrict`**

In `apps/web/src/lib/wallet-modal.ts`, refactor so both variants share one body — replace the existing `openWalletModal` with:

```ts
/**
 * Open the wallet-connect modal, initializing AppKit on first call.
 * Rejects on failure — for callers that drive UI state off the outcome
 * (e.g. the onboarding connect step's error state).
 */
export async function openWalletModalStrict(): Promise<void> {
  if (typeof window === "undefined") return;
  const modal = await getModal();
  await modal.open();
}

/** Fire-and-forget variant for plain buttons: failures are logged, not thrown. */
export async function openWalletModal(): Promise<void> {
  try {
    await openWalletModalStrict();
  } catch (error) {
    log.error("open_failed", { error });
  }
}
```

Run: `pnpm vitest run src/lib/wallet-modal.test.ts` — PASS (5 tests).

- [ ] **Step 3: trading-onboarding uses the strict variant**

In `apps/web/src/components/trading-onboarding.tsx`, change the import to include `openWalletModalStrict` and at line ~290 change `await openWalletModal();` to `await openWalletModalStrict();` (the surrounding try/catch that sets the step to "error" is now reachable). Drop `openWalletModal` from the import if unused.

- [ ] **Step 4: Pending state + preload on every connect button**

The shared pattern — each connect button's component gains:

```tsx
const [connecting, setConnecting] = useState(false);

const handleConnect = async () => {
  if (connecting) return;
  setConnecting(true);
  try {
    await openWalletModal();
  } finally {
    setConnecting(false);
  }
};
```

and the button becomes (preserving each button's existing classNames/children — only add the three props and swap the label while pending):

```tsx
<button
  type="button"
  disabled={connecting}
  onMouseEnter={preloadWalletModal}
  onFocus={preloadWalletModal}
  onClick={() => void handleConnect()}
  ...existing className etc...
>
  {connecting ? "Connecting…" : /* existing children */}
</button>
```

Apply to all five: `navbar.tsx` (keep its `posthog.capture("wallet_connect_clicked")` inside `handleConnect` before the await), `top-nav.tsx`, `sidebar-mobile.tsx`, `portfolio/page.tsx`, `trading-form.tsx` (its pending label: `"Connecting…"` in place of "Connect Wallet to Trade"). For buttons that render icon + text children, only swap the text node while pending, keep the icon. Add the `preloadWalletModal` import where missing; navbar and trading-form already have it.

NOTE: `openWalletModal` resolves when the modal OPENS (not when the user finishes connecting), so the pending window is exactly the chunk-load + boot gap — the thing users perceived as a dead button.

- [ ] **Step 5: Verify**

`pnpm typecheck && pnpm lint && pnpm vitest run src/lib/` — clean/green. `grep -rn "void openWalletModal()" src` — remaining direct fire-and-forget calls should now exist only inside the new `handleConnect` helpers (no bare onClick ones left).

---

### Task 2: Dead code removal

**Files:**
- Delete: `apps/web/src/components/trading/order-summary.tsx`, `price-input.tsx`, `shares-input.tsx`, `outcome-selector.tsx`, `buy-sell-toggle.tsx`, `balance-warning.tsx`, `order-type-toggle.tsx`, `allowance-warning.tsx`
- Modify: `apps/web/src/lib/extension-auth.ts` (remove `verifyExtensionAccess`)
- Modify: `apps/web/src/context/wallet-context.tsx` (remove `disconnect` from the context)

- [ ] **Step 1: Re-verify zero usage, then delete the 8 components**

```bash
for f in order-summary price-input shares-input outcome-selector buy-sell-toggle balance-warning order-type-toggle allowance-warning; do echo -n "$f: "; grep -rln "trading/$f" src | grep -v "components/trading/$f" | wc -l; done
```

All must print 0 (confirmed at planning time). Then delete the 8 files. If `src/components/trading/` has an `index.ts` barrel re-exporting any of them, update it.

- [ ] **Step 2: Remove `verifyExtensionAccess`**

`grep -rn "verifyExtensionAccess\b" src` — expect hits only in `extension-auth.ts` itself (the pre-auth variant no longer calls it; verify before deleting — if anything still calls it, STOP and report). Delete the function and its `allowLowTrustFallback` options type. Keep `verifyExtensionRequest` (used by the pre-auth fallback).

- [ ] **Step 3: Remove the misleading `disconnect` from WalletContext**

In `apps/web/src/context/wallet-context.tsx`: confirmed at planning time that no component calls `disconnect` via this context (real disconnect goes through wagmi's `useDisconnect` in wallet-menu). Remove `disconnect` from `WalletContextValue`, from the `value` memo, and the `closeWalletModal` import if now unused. If typecheck reveals a consumer the grep missed, STOP and report instead of keeping it.

- [ ] **Step 4: Verify**

`pnpm typecheck && pnpm lint && pnpm vitest run src/lib/` — clean. `pnpm exec next build 2>&1 | tail -5` — succeeds.

---

### Task 3: Landing theme FOUC — pre-paint inline script

**Files:**
- Modify: `apps/web/src/components/landing/landing-shell.tsx`
- Modify: `apps/web/src/components/kw-theme-state.ts` (export the dark-theme list for the script)

Background: the shell renders `data-theme="light"` until React mounts; dark-theme visitors see a light flash. next-themes already sets the theme class on `<html>` pre-paint via its own injected script, but the `.kw-page` CSS keys off `data-theme` on the shell div. Fix: a tiny inline script rendered as the FIRST CHILD of the shell div that reads next-themes' localStorage key and stamps the parent's `data-theme`/`data-scheme` before the rest of the document paints. React hydration then re-renders the same attributes post-mount (`useKwTheme` converges to the same value); `suppressHydrationWarning` covers the pre-mount frame where server HTML said "light".

- [ ] **Step 1: Export the dark set from kw-theme-state**

Append to `apps/web/src/components/kw-theme-state.ts`:

```ts
/** Theme values that map to a dark color-scheme — consumed by the
 *  pre-paint inline script in landing-shell so it can set data-scheme
 *  without importing the full KW_THEMES table into the script string. */
export const KW_DARK_THEME_VALUES: readonly KwTheme[] = KW_THEMES.filter(
  (t) => t.isDark
).map((t) => t.value);
```

- [ ] **Step 2: Add the inline script to LandingShell**

In `apps/web/src/components/landing/landing-shell.tsx`, import the new export and build the script once at module scope:

```ts
import { KW_DARK_THEME_VALUES } from "@/components/kw-theme-state";

// Pre-paint theme stamp. Runs while the HTML is streaming, before first
// paint of the content below it: reads the next-themes key and corrects
// the parent div's theme attributes so dark-theme visitors never see the
// server-rendered "light" frame. Must stay dependency-free and tiny.
const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(!t||t==="light")return;var d=${JSON.stringify(KW_DARK_THEME_VALUES)};var p=document.currentScript.parentElement;p.setAttribute("data-theme",t);var s=d.indexOf(t)>=0?"dark":"light";p.setAttribute("data-scheme",s);p.style.colorScheme=s;}catch(e){}})()`;
```

Then inside the root div, render the script as the first child and add `suppressHydrationWarning` to the div:

```tsx
    <div
      className={...unchanged...}
      data-theme={theme}
      data-scheme={colorScheme}
      style={{ colorScheme }}
      suppressHydrationWarning
    >
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static pre-paint theme stamp, no user input
        dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
      />
      ...existing children unchanged...
```

(If biome's ignore-comment syntax differs, follow whatever `pnpm lint` asks for. The script contains no `<` and no user input; serializeJsonLd is not needed.)

- [ ] **Step 3: Verify**

`pnpm typecheck && pnpm lint` clean. Functional check happens in Task 14 (set theme to dark, hard-reload `/`, confirm no light flash — observable via a screenshot taken immediately on navigation, and `data-theme` being dark before React mounts: `document.querySelector('[data-theme]').getAttribute('data-theme')` evaluated with an init script).

---

### Task 4: framer-motion → LazyMotion with lazy-loaded features

**Files:**
- Create: `apps/web/src/lib/motion-features.ts`
- Modify: `apps/web/src/context/index.tsx` (mount LazyMotion)
- Modify: ~31 files importing `framer-motion` (mechanical codemod)

Background: 31 client files import `motion`/`AnimatePresence` from the full framer-motion runtime. `LazyMotion` + `m` keeps component code tiny and loads the animation engine asynchronously after hydration — entry fades simply start once features arrive. One file (`src/components/portfolio/tab-nav.tsx`) uses layout-animation APIs, so features must be `domMax` (covers layout + everything `domAnimation` has).

- [ ] **Step 1: Create the features module**

`apps/web/src/lib/motion-features.ts`:

```ts
import { domMax } from "framer-motion";

/**
 * Loaded asynchronously by <LazyMotion features={loadMotionFeatures}> so the
 * animation engine stays out of initial route bundles. domMax (not
 * domAnimation) because portfolio/tab-nav.tsx uses layout animations.
 */
export default domMax;
```

- [ ] **Step 2: Mount LazyMotion in the provider stack**

In `apps/web/src/context/index.tsx` add:

```ts
import { LazyMotion } from "framer-motion";

const loadMotionFeatures = () =>
  import("@/lib/motion-features").then((mod) => mod.default);
```

and wrap the children INSIDE ThemeProvider (so it covers every animated surface):

```tsx
<LazyMotion features={loadMotionFeatures} strict>
  <AccentColorProvider>
    ...existing tree unchanged...
  </AccentColorProvider>
</LazyMotion>
```

`strict` makes any leftover `motion.` component throw at render — the enforcement for Step 3.

- [ ] **Step 3: Codemod all 31 files**

Enumerate: `grep -rln "from \"framer-motion\"" src`. For each file the transformation is exactly:
- `import { motion, ... } from "framer-motion"` → `import { m, ... } from "framer-motion"` (keep `AnimatePresence` and other named imports as-is)
- every JSX `motion.<tag>` → `m.<tag>`

Worked example (`src/components/event-card.tsx`): `import { motion } from "framer-motion"` → `import { m } from "framer-motion"`; `<motion.div initial={...}>` → `<m.div initial={...}>` (props unchanged).

Exception: `src/lib/motion-features.ts` and `src/context/index.tsx` import `domMax`/`LazyMotion` — leave them. If any file imports motion APIs that are VALUES (e.g. `animate()` standalone, `useMotionValue`) keep those named imports unchanged — only the `motion` component proxy becomes `m`.

- [ ] **Step 4: Verify zero stragglers**

```bash
grep -rn "motion\." src --include="*.tsx" | grep -v "m\.\|framer-motion\|motion-features" | grep "<motion" ; grep -rn "import { motion" src
```

Both empty. `pnpm typecheck && pnpm lint` clean. `pnpm exec next build` succeeds. Functional animation check in Task 14.

---

### Task 5: Grid render cost — content-visibility on card grids

**Files:**
- Modify: `apps/web/src/components/event-card.tsx` (root element className)

Background: the home/markets infinite grid accumulates hundreds of cards; full virtualization of a responsive CSS grid is high-risk, but CSS `content-visibility: auto` lets the browser skip layout/paint for offscreen cards at near-zero risk. (The whales ledger already uses real `virtua` virtualization — unchanged.)

- [ ] **Step 1: Add containment classes to the card root**

In `apps/web/src/components/event-card.tsx`, on the root `m.div` (after Task 4) add to its className: `[content-visibility:auto] [contain-intrinsic-size:auto_360px]` (Tailwind arbitrary properties). 360px ≈ the card's typical rendered height; `auto` keeps the last measured size so scrollbar stays stable.

- [ ] **Step 2: Verify**

`pnpm typecheck && pnpm lint` clean. In Task 14: scroll the home grid past ~60 cards and confirm no layout jumping and smooth scroll (screenshot + console clean).

---

### Task 6: `useNow` hook + relative-time ticker leaf

**Files:**
- Create: `apps/web/src/hooks/use-now.ts`
- Create: `apps/web/src/hooks/use-now.test.ts`
- Modify: `apps/web/src/app/leaderboard/leaderboard-content.tsx:~167-172`, `apps/web/src/app/profile/[address]/page.tsx:~104-109`, `apps/web/src/app/whales/page.tsx:~152-156`, `apps/web/src/app/events/detail/[slug]/team-matchup-hero.tsx:~122`

- [ ] **Step 1: Failing test**

`apps/web/src/hooks/use-now.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./use-now";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns the current time and ticks at the given interval", () => {
    const { result } = renderHook(() => useNow(5_000));
    const first = result.current;
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current - first).toBe(5_000);
  });

  it("clears its interval on unmount", () => {
    const { unmount } = renderHook(() => useNow(1_000));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

(If `@testing-library/react` isn't a dependency, check package.json — the repo runs vitest+jsdom; if absent, write the test against a tiny harness component with `react-dom/test-utils` — but check first, several component tests exist e.g. `tag-events-content.test.tsx`, and follow whatever they use.)

Run — FAIL (module missing).

- [ ] **Step 2: Implement**

`apps/web/src/hooks/use-now.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

/**
 * Ticking clock for "updated Xs ago" labels. Mount this in the LEAF
 * component that renders the label — never at page level, where every
 * tick re-renders the whole tree (the bug this hook replaces).
 */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
```

Run — PASS.

- [ ] **Step 3: Migrate the four call sites — into leaves**

For each of the four files: locate the copy-pasted `const [now, setNow] = useState(() => Date.now()); useEffect(... setInterval(() => setNow(Date.now()), 1000) ...)` block and what `now` feeds.
- If `now` only feeds an "updated Xs ago" (or countdown) label: extract that label into a small local component in the same file (e.g. `function UpdatedAgo({ ts }: { ts: number }) { const now = useNow(5_000); return <span>...same formatting as before...</span>; }`) and delete the page-level state. Interval moves from 1s page-wide to 5s leaf-only — matching the existing good pattern in `markets-view.tsx:310-325`.
- If `now` feeds other computations too (filtering, countdown math affecting layout): replace the block with `const now = useNow(1_000);` (page still ticks, but the duplicated boilerplate is gone) and note it in the report.

- [ ] **Step 4: Verify**

`pnpm typecheck && pnpm lint && pnpm vitest run src/hooks/use-now.test.ts src/lib/` green. `grep -rn "setNow(Date.now())" src` — remaining hits only inside `use-now.ts` (and `markets-view.tsx`'s existing leaf if not migrated — migrate it to `useNow` too if trivial, else leave and note).

---

### Task 7: Polling alignment

**Files:**
- Modify: `apps/web/src/components/sportsbook-view.tsx:318`
- Modify: `apps/web/src/app/events/sports/live/page.tsx:~245`
- Modify: `apps/web/src/hooks/use-user-positions.ts:~174-175`

- [ ] **Step 1: Align refetch intervals with the 60s edge cache**

`sportsbook-view.tsx:318`: `refetchInterval: liveOnly ? 10_000 : 30_000` → `refetchInterval: liveOnly ? 30_000 : 60_000` with a comment: `// /api/events/* is edge-cached for 60s (s-maxage) — polling faster than ~half the TTL only re-downloads cached bytes.`

`events/sports/live/page.tsx` ~line 245: find its `refetchInterval` (30s per review) — if 30_000 leave it (matches half-TTL), if faster align to 30_000.

- [ ] **Step 2: Fix the lying comments in use-user-positions**

Line ~174: `staleTime: 10 * 1000, // 5 seconds - more responsive after trades` → comment becomes `// 10 seconds — responsive after trades`. Line ~175: `refetchInterval: 30 * 1000, // Refetch every 15 seconds` → `// Refetch every 30 seconds`.

- [ ] **Step 3: Verify** — `pnpm typecheck && pnpm lint`; behavior check in Task 14 (sportsbook still updates).

---

### Task 8: `/api/events/league-counts` — fold live count into the pool, drop no-store

**Files:**
- Modify: `apps/web/src/app/api/events/league-counts/route.ts:~156-165` and the `fetchGammaKeysetPage` call with `cache: "no-store"` (~line 244)

- [ ] **Step 1: Parallelize the live count**

Replace the sequential block:

```ts
    const counts = await mapWithConcurrency(
      slugs,
      COUNT_FETCH_CONCURRENCY,
      (slug) => fetchCount(COUNT_FILTERS_BY_TAG_SLUG.get(slug), false)
    );
    const liveCount = await fetchCount(
      COUNT_FILTERS_BY_TAG_SLUG.get(ALL_SPORTS_TAG_SLUG),
      true
    );
```

with:

```ts
    // Run the live count concurrently with the per-slug pool instead of
    // paying one extra serial round-trip after it.
    const [counts, liveCount] = await Promise.all([
      mapWithConcurrency(slugs, COUNT_FETCH_CONCURRENCY, (slug) =>
        fetchCount(COUNT_FILTERS_BY_TAG_SLUG.get(slug), false)
      ),
      fetchCount(COUNT_FILTERS_BY_TAG_SLUG.get(ALL_SPORTS_TAG_SLUG), true),
    ]);
```

- [ ] **Step 2: Cache the counting pages upstream**

Find the `cache: "no-store"` inside this route's page-fetch helper (~line 244). Replace with `next: { revalidate: 60 }` and adjust the comment: counting pages may be up to 60s stale, acceptable for a count badge that's already edge-cached for 60s. READ the helper first — if `fetchGammaKeysetPage` is shared with callers that genuinely need fresh data, add a caller-controlled option instead of changing the shared default (report which shape you found).

- [ ] **Step 3: Verify** — `pnpm typecheck && pnpm lint`; in Task 14 hit `/api/events/league-counts?...` (copy the query the sports page sends) and confirm 200 + sane counts.

---

### Task 9: `/api/trader/x-profile` — parallelize the index crawl

**Files:**
- Modify: `apps/web/src/app/api/trader/x-profile/route.ts:110-130`

- [ ] **Step 1: Parallelize**

Replace the nested sequential loop in `refreshTraderXProfileIndex` with a concurrent fan-out (offsets are known up front; a short page means later offsets return empty — harmless):

```ts
async function refreshTraderXProfileIndex(): Promise<
  Map<string, TraderXProfile>
> {
  // All page coordinates are known up front — fetch them concurrently
  // instead of ~42 serial round-trips. Later offsets past the end of the
  // leaderboard return short/empty pages, which buildTraderXProfileIndex
  // already tolerates.
  const offsets: number[] = [];
  for (let o = 0; o <= LEADERBOARD_MAX_OFFSET; o += LEADERBOARD_LIMIT) {
    offsets.push(o);
  }
  const pages = await Promise.all(
    LEADERBOARD_ORDERS.flatMap((orderBy) =>
      offsets.map((offset) =>
        fetchLeaderboardPage(orderBy, offset).catch(() => [])
      )
    )
  );
  const traders: unknown[] = pages.flat();

  const index = buildTraderXProfileIndex(traders);
  cachedIndex = {
    expiresAt: Date.now() + INDEX_TTL_MS,
    index,
```

(Keep everything after `cachedIndex = {` as-is. READ `fetchLeaderboardPage` first: if it already catches and returns `[]` on failure, drop the `.catch(() => [])`. If duplicate traders across orderBys matter, check `buildTraderXProfileIndex` — it builds a Map keyed by address, so duplicates collapse; confirm and note.)

- [ ] **Step 2: Verify** — `pnpm typecheck && pnpm lint`. Note in the report that worst-case upstream request COUNT is unchanged (42) but wall-clock drops from ~42 RTTs to ~1-2.

---

### Task 10: Formatter consolidation (adaptive cents, addresses, relative time)

**Files:**
- Modify: `apps/web/src/lib/formatters.ts` (add `formatCents`, `relativeTime`)
- Create: `apps/web/src/lib/formatters.test.ts`
- Modify (migrations): `src/components/markets-view.tsx:112`, `src/components/order-book-summary.tsx:37`, `src/components/live-sportsbook.tsx:~670-703,2674`, `src/components/trading-form.tsx:~217`, `src/app/events/detail/[slug]/candidate-ticker.tsx`, `src/app/events/detail/[slug]/field-tiles.tsx`, `src/components/pnl-chart.tsx:~30,43`, `src/components/portfolio/pnl-card.tsx:~17,29`, `src/components/navbar.tsx:~21`, `src/components/top-nav.tsx:~55`, `src/components/leaderboard/leaderboard-table.tsx:~37`, `src/app/profile/[address]/page.tsx:~28`, `src/app/whales/_lib/formatters.ts`, `src/app/events/detail/[slug]/outcomes-table.tsx:~66`, `src/components/notifications/notification-item.tsx:~104`, `src/components/markets-view.tsx:~297` (compactAgo)

- [ ] **Step 1: Failing tests for the two new canonical functions**

`apps/web/src/lib/formatters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatCents, relativeTime } from "./formatters";

describe("formatCents", () => {
  it("strips the decimal when the value is whole cents", () => {
    expect(formatCents(0.75)).toBe("75¢");
    expect(formatCents("0.75")).toBe("75¢");
  });
  it("keeps one decimal of sub-cent precision when present", () => {
    expect(formatCents(0.753)).toBe("75.3¢");
    expect(formatCents(0.005)).toBe("0.5¢");
  });
  it("rounds half-up at one decimal", () => {
    expect(formatCents(0.7535)).toBe("75.4¢"); // 75.35 -> 75.4 half-up
  });
  it("handles garbage", () => {
    expect(formatCents(Number.NaN)).toBe("0¢");
    expect(formatCents("not-a-number")).toBe("0¢");
  });
});

describe("relativeTime", () => {
  const now = Date.now();
  it("compact style", () => {
    expect(relativeTime(now - 5 * 60_000, "compact", now)).toBe("5m");
    expect(relativeTime(now - 3 * 3_600_000, "compact", now)).toBe("3h");
  });
  it("verbose style", () => {
    expect(relativeTime(now - 5 * 60_000, "verbose", now)).toBe("5m ago");
    expect(relativeTime(now - 30_000, "verbose", now)).toBe("just now");
  });
});
```

Run — FAIL.

- [ ] **Step 2: Implement in `lib/formatters.ts`**

```ts
/**
 * Canonical price-in-cents display. Adaptive precision (owner decision,
 * 2026-06-11): never round away available sub-cent precision — this is a
 * financial app — but don't show a noisy ".0" when the value is whole.
 *   0.75   -> "75¢"
 *   0.753  -> "75.3¢"   (one decimal, Decimal half-up)
 */
export function formatCents(price: string | number): string {
  try {
    const cents = new Decimal(price).mul(100);
    if (!cents.isFinite()) return "0¢";
    const rounded = cents.toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
    return rounded.isInteger()
      ? `${rounded.toFixed(0)}¢`
      : `${rounded.toFixed(1)}¢`;
  } catch {
    return "0¢";
  }
}

/**
 * One relative-time formatter for both UI styles:
 *   compact -> "5m" / "3h" / "2d"      (tickers, tables)
 *   verbose -> "5m ago" / "just now"   (feeds, notifications)
 * `nowMs` is injectable for tests and useNow() integration.
 */
export function relativeTime(
  timestamp: string | number | Date,
  style: "compact" | "verbose" = "verbose",
  nowMs: number = Date.now()
): string {
  const then = new Date(timestamp).getTime();
  const diffMins = Math.floor((nowMs - then) / 60_000);
  if (style === "verbose" && diffMins < 1) return "just now";
  const units: Array<[number, string]> = [
    [60 * 24 * 30 * 12, "y"],
    [60 * 24 * 30, "mo"],
    [60 * 24, "d"],
    [60, "h"],
    [1, "m"],
  ];
  for (const [mins, label] of units) {
    if (diffMins >= mins) {
      const v = `${Math.floor(diffMins / mins)}${label}`;
      return style === "compact" ? v : `${v} ago`;
    }
  }
  return style === "compact" ? "0m" : "just now";
}
```

Run tests — PASS. (Leave existing `formatPrice` — order-book surfaces that always want 1dp keep using it; `timeAgo` stays for back-compat until all its callers migrate to `relativeTime`, then delete it if caller count hits zero — check with grep and report.)

- [ ] **Step 3: Migrate cents call sites**

For each local cents/percent formatter listed in Files: delete the local function and import from `@/lib/formatters`:
- `markets-view.tsx:112` local whole-cent `formatCents` → canonical `formatCents` (cards GAIN sub-cent precision when present — intended).
- `order-book-summary.tsx:37` local 1dp formatter → existing `formatPrice` (zero visual change).
- `live-sportsbook.tsx` local Decimal cents/percent helpers (~670-703) → `formatCents`; its relative-time helpers (~690, 2674) → `relativeTime(ts, "compact")`.
- `trading-form.tsx:~217`, `candidate-ticker.tsx`, `field-tiles.tsx` local cents → `formatCents`; `field-tiles.tsx` compact-money local → `formatCurrencyCompact`.
- `pnl-chart.tsx` / `pnl-card.tsx` local `formatCurrency`/`formatPercent` → canonical imports. NOTE the repo rule: positive P&L must NOT get a `+` prefix (green already signals it) — when migrating, pass `showSign=false` for gains or keep each component's current sign behavior EXACTLY; if a local copy added `+`, preserving current behavior wins over the lib default — read each call and report.

- [ ] **Step 4: Migrate address + relative-time call sites**

`navbar.tsx`, `top-nav.tsx`, `leaderboard-table.tsx`, `profile/[address]/page.tsx`, `whales/_lib/formatters.ts` local `formatAddress` → import canonical (whales' lib file may re-export from `@/lib/formatters` if other whales modules import from it — prefer deleting the local and fixing importers). `outcomes-table.tsx:66`, `notification-item.tsx:104`, `markets-view.tsx:297 compactAgo` → `relativeTime` with the style matching their current output (compare outputs before/after on a sample value — same bucket text or report the diff).

- [ ] **Step 5: Verify**

`pnpm typecheck && pnpm lint && pnpm vitest run src/lib/` green. `grep -rn "function formatCents\|function formatAddress\|const formatAddress" src | grep -v "lib/formatters"` → empty. `pnpm exec next build` succeeds.

---

### Task 11: Typed `fetchJson` helper + hook migration

**Files:**
- Create: `apps/web/src/lib/fetch-json.ts`
- Create: `apps/web/src/lib/fetch-json.test.ts`
- Modify: ~21 hooks in `src/hooks/` (grep-enumerated)

- [ ] **Step 1: Failing test**

`apps/web/src/lib/fetch-json.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "./fetch-json";

afterEach(() => vi.unstubAllGlobals());

describe("fetchJson", () => {
  it("returns parsed JSON on ok responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"a":1}', { status: 200 })));
    await expect(fetchJson<{ a: number }>("/api/x")).resolves.toEqual({ a: 1 });
  });

  it("throws a descriptive error on non-ok responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"nope"}', { status: 502 })));
    await expect(fetchJson("/api/x")).rejects.toThrow("/api/x failed (502): nope");
  });

  it("throws the envelope error when success is false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"success":false,"error":"bad"}', { status: 200 })));
    await expect(fetchJson("/api/x")).rejects.toThrow("bad");
  });

  it("passes through success envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"success":true,"tags":[]}', { status: 200 })));
    await expect(fetchJson("/api/x")).resolves.toEqual({ success: true, tags: [] });
  });
});
```

Run — FAIL.

- [ ] **Step 2: Implement**

`apps/web/src/lib/fetch-json.ts`:

```ts
/**
 * The one fetch wrapper for first-party /api/* calls from client hooks.
 * Replaces ~21 hand-rolled copies of fetch -> ok-check -> json ->
 * success-unwrap. Throws on transport failure, non-2xx, and explicit
 * `{ success: false }` envelopes; resolves with the parsed body otherwise.
 */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, init);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON body — fall through to the status check
  }
  const envelope = body as { success?: boolean; error?: string } | null;
  if (!response.ok) {
    throw new Error(
      `${url} failed (${response.status}): ${envelope?.error ?? response.statusText}`
    );
  }
  if (envelope && envelope.success === false) {
    throw new Error(envelope.error || `${url} returned success=false`);
  }
  return body as T;
}
```

Run — PASS (4 tests).

- [ ] **Step 3: Migrate hooks**

Enumerate: `grep -rln "Failed to fetch" src/hooks`. For each hook, replace the fetch/ok-check/json/success-unwrap block in its `queryFn` fetcher with a `fetchJson<ResponseType>(url)` call, preserving the URL construction and the post-unwrap field extraction. Worked example for `use-tags.ts`'s `fetchTags`:

```ts
async function fetchTags(): Promise<Tag[]> {
  const data = await fetchJson<TagsResponse>("/api/tags");
  return data.tags || [];
}
```

Hooks whose error MESSAGES are asserted in existing tests: run `pnpm vitest run src/hooks` after migrating and fix any message-specific assertions to the new `fetchJson` format (the new messages are strictly more informative — include URL + status).

- [ ] **Step 4: Verify** — `pnpm typecheck && pnpm lint && pnpm vitest run src/` green; `grep -rn "Failed to fetch" src/hooks | wc -l` → 0 (or report the justified survivors, e.g. POST bodies with special handling).

---

### Task 12: API error envelope helper

**Files:**
- Create: `apps/web/src/lib/api-error.ts`
- Create: `apps/web/src/lib/api-error.test.ts`
- Modify: routes returning bare `{ error: ... }` (grep-enumerated, ~36 routes)

Background: 36 routes return `{ error }`, 37 return `{ success: false, error }`. Standardize ADDITIVELY on the superset `{ success: false, error }` — bare-`{error}` consumers keep working (the `error` field remains), and `success`-checking consumers start working everywhere.

- [ ] **Step 1: Failing test**

`apps/web/src/lib/api-error.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { jsonError } from "./api-error";

describe("jsonError", () => {
  it("returns the standard envelope with the given status", async () => {
    const res = jsonError("nope", 404);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ success: false, error: "nope" });
  });
  it("merges extra headers", () => {
    const res = jsonError("slow down", 429, { "Retry-After": "30" });
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
```

Run — FAIL.

- [ ] **Step 2: Implement**

`apps/web/src/lib/api-error.ts`:

```ts
import { NextResponse } from "next/server";

/**
 * The one error envelope for /api/* routes: `{ success: false, error }`.
 * Superset of the legacy bare `{ error }` shape, so adopting it is
 * non-breaking for existing consumers. Errors are never cacheable.
 */
export function jsonError(
  error: string,
  status: number,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    { success: false, error },
    { status, headers: { "Cache-Control": "no-store", ...headers } }
  );
}
```

Run — PASS.

- [ ] **Step 3: Adopt in bare-`{error}` routes**

Enumerate: `grep -rln "NextResponse.json(" src/app/api | xargs grep -ln "{ error:" | head -50` (refine as needed — the targets are routes whose error returns lack `success: false`). For each: replace `return NextResponse.json({ error: X }, { status: Y })` with `return jsonError(X, Y)` and add the import. Routes that attach CORS headers to error responses (the AI routes) keep their header-copy loops — pass nothing extra, the loops mutate the response after. Do NOT touch routes already returning `{ success: false, ... }` with extra fields (e.g. structured AI fallbacks) — only bare `{ error }` shapes. Report the converted count.

- [ ] **Step 4: Verify** — `pnpm typecheck && pnpm lint && pnpm vitest run src/lib/` green; `pnpm exec next build` succeeds; spot-check two converted routes in Task 14 (error responses carry both fields + no-store).

---

### Task 13: Shared zod query schemas + qk adoption

**Files:**
- Create: `apps/web/src/lib/api-query.ts` (+ test)
- Modify: priority unvalidated routes: `src/app/api/markets/price-history/[tokenId]/route.ts`, `src/app/api/events/trending/route.ts`, `src/app/api/whales/activity/route.ts`, `src/app/api/whales/suspicious/route.ts`
- Modify: `src/lib/query-keys.ts` (+ inline-key migrations)

- [ ] **Step 1: Failing test + schema module**

`apps/web/src/lib/api-query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampedInt, tokenIdSchema } from "./api-query";

describe("api-query schemas", () => {
  it("tokenIdSchema accepts long numeric ids and rejects junk", () => {
    expect(tokenIdSchema.safeParse("12345678901").success).toBe(true);
    expect(tokenIdSchema.safeParse("abc").success).toBe(false);
    expect(tokenIdSchema.safeParse("123").success).toBe(false);
  });
  it("clampedInt coerces, clamps and defaults", () => {
    const limit = clampedInt(1, 100, 20);
    expect(limit.parse("50")).toBe(50);
    expect(limit.parse("9999")).toBe(100);
    expect(limit.parse(undefined)).toBe(20);
    expect(limit.parse("-3")).toBe(1);
  });
});
```

`apps/web/src/lib/api-query.ts`:

```ts
import { z } from "zod";

/** CLOB token ids are long decimal strings (>=10 digits). */
export const tokenIdSchema = z.string().regex(/^\d{10,}$/, "invalid token id");

/** Coercing integer query param with clamping and a default. */
export function clampedInt(min: number, max: number, fallback: number) {
  return z.coerce
    .number()
    .int()
    .catch(fallback)
    .transform((v) => Math.min(max, Math.max(min, v)))
    .default(fallback);
}

/** Polygon address (checksummed or lowercase). */
export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "invalid address");
```

Run test — adjust until PASS (zod v4 is in use — `z.coerce.number().catch()` semantics: verify against the installed zod; if `.catch` ordering differs, restructure as `z.preprocess` — the TEST is the contract, make it pass without weakening it).

- [ ] **Step 2: Apply to the four priority routes**

For each route, parse `searchParams` through the shared schemas at the top of the handler and use parsed values below; on parse failure return `jsonError(<first issue message>, 400)` (Task 12). Specifically: `price-history/[tokenId]` validates `tokenId` with `tokenIdSchema` and clamps `fidelity` (1..1440, default match current behavior — READ the file for current defaults) and `startTs` (0..4102444800); `events/trending` clamps `limit`; `whales/activity` clamps `whaleCount` (1..100) and validates `timePeriod` against its existing allowlist via `z.enum`; `whales/suspicious` same pattern for its params (read the file for the actual names). Behavior for VALID inputs must be byte-identical — these schemas only tighten the invalid-input paths.

- [ ] **Step 3: qk adoption**

Enumerate inline keys: `grep -rn 'queryKey: \[\"' src --include="*.tsx" --include="*.ts" | grep -v "query-keys"`. Add the missing factories to `qk` following the file's documented conventions (e.g. `orderBook: (tokenId: string) => ["orderBook", tokenId] as const` under a fitting domain — KEEP the existing string spellings exactly so live caches/invalidations are unaffected), then migrate every call site to the factory. The cross-file coupled ones called out in the review: `["orderBook", tokenId]` (event-detail-client.tsx ×2, order-book.tsx) and `["companion-markets", ...]` (sports/live page, sportsbook-view). Report before/after counts.

- [ ] **Step 4: Verify** — `pnpm typecheck && pnpm lint && pnpm vitest run src/` green; grep from Step 3 returns zero (or justified survivors); `pnpm exec next build` succeeds.

---

### Task 14: Full verification (gates + chrome-devtools)

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test` — all green (lint: only the 19 pre-existing globals.css warnings).
- [ ] **Step 2:** `pnpm exec next build` — succeeds; note route-size deltas vs `tmp/bundle-after.txt` (LazyMotion should shave route chunks further).
- [ ] **Step 3:** chrome-devtools against a production `next start` on a FREE port (check 8000 first — if the owner's dev server is running there, use 8001 and `rm -rf .next` is NOT needed unless the build 500s on stale vendor chunks — known prior issue):
  1. `/` renders; set theme to a dark theme, hard-reload — capture an immediate screenshot: no light flash, `data-theme` correct pre-hydration.
  2. Home grid: scroll past 60+ cards — smooth, no layout jumps (content-visibility), entry animations still play on first cards (LazyMotion features loaded).
  3. `/markets`: prices show adaptive cents (whole values without ".0"); click Connect — button shows "Connecting…" then the modal opens; rapid double-click safe.
  4. Event detail: order book still shows 1dp prices; outcomes table relative times render.
  5. `/whales`, `/leaderboard`, `/profile/<any address from leaderboard>`: render, "updated ago" labels tick, no full-page re-render jank (React DevTools not required — observe smoothness), console clean.
  6. API probes: a converted error route returns `{ success: false, error }` + `Cache-Control: no-store`; `/api/markets/price-history/<junk>` → 400; `/api/whales/activity?whaleCount=9999` → clamped 200, not 500.
  7. `list_console_messages` on every visited page: zero errors.
- [ ] **Step 4:** Report results + leave everything uncommitted.

---

## Deferred to plan 4 (write after this plan lands)

God-file splits: `live-sportsbook.tsx` (3,034), `event-detail-client.tsx` (1,988), `agent-dashboard-client.tsx` (2,087), `use-clob-client.ts` (1,090). This plan's formatter/useNow/qk migrations shrink and decouple those files first; plan 4 will split what remains along the seams the review identified (sportsbook parsing → `lib/sportsbook/`, event-detail fetchers → hooks, clob hook → composable services).

## Self-review notes

- Coverage vs the pending list: quick wins 1-4 → Tasks 1-3; LazyMotion → 4; grid cost → 5 (content-visibility chosen over VGrid restructure — justified inline); tickers/polling → 6-7; slow routes → 8-9; formatters → 10; fetchJson → 11; envelope → 12; zod + qk → 13. Rate-limit store + navbar/top-nav convergence + god files explicitly out (owner decisions/deferred).
- Type consistency: `formatCents`/`relativeTime` defined in Task 10 before migration steps; `jsonError` (Task 12) referenced by Task 13 Step 2 — execution order matters: run tasks in numeric order.
- Known risks called out inline: zod `.catch` semantics (Task 13 Step 1), shared `fetchGammaKeysetPage` default (Task 8 Step 2), P&L `+`-prefix rule (Task 10 Step 3), test-library availability (Task 6 Step 1).
