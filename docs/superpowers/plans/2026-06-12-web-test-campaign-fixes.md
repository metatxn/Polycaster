# Web Test-Campaign Fixes Implementation Plan (Plan 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **OWNER OVERRIDE — NO COMMITS:** The repo owner commits manually. Never run `git add` or `git commit`. Leave all changes uncommitted. Wherever a workflow would normally commit, stop after tests pass.

**Goal:** Fix every issue found by the 2026-06-12 browser-AI test campaign — the React #418 hydration mismatches (3 diagnosed root causes), two sports-live layout majors, four medium bugs, and the full minor sweep (readability floor, heading hierarchy, formatting/copy, a11y).

**Architecture:** Three hydration fixes restore SSR stickiness on event-detail pages. Layout fixes are CSS/JSX-local. Several items are investigate-then-fix (pagination boundary, leaderboard scroll-jump, backtest hang, "MARKETS SHOWN" string) with explicit recipes. The readability floor is a scoped CSS layer in globals.css. Every task ends with the standard gates; the final task re-verifies each fixed finding in the browser at the exact viewport that failed.

**Tech Stack:** Next.js 15 App Router (dynamic SSR, deployed to Cloudflare Workers — renders in UTC), React 19, Tailwind v4, TanStack Query, vitest, biome.

**Working directory:** `/Users/nareshkatta/Desktop/Soclly/polycaster/apps/web` for all commands.

**Gates (every task):**
```bash
pnpm tsc --noEmit          # exit 0
pnpm vitest run            # all pass (157+ as of plan 4)
pnpm biome check src       # 0 errors (19 pre-existing globals.css warnings = baseline)
```

---

## Context for implementers

- Prediction-markets app ("Knoww"). Body SSR only recently started working (a null-returning provider was removed), so hydration mismatches are newly exposed — before, the server rendered nothing and nothing could mismatch.
- Owner display rule (firm): **no `+` prefix on positive P&L** — green signals positive; losses keep `-`.
- Owner workflow rule (firm): **no git commits**.
- Port 8000 may run the owner's dev server — NEVER touch it. Production verification uses port 8001. If `next start` fails with `Cannot find module './vendor-chunks/...'`: `rm -rf .next && pnpm next build` and retry. NEVER run `next build` while a dev server is using the same `.next` (it clobbers it).
- The full findings come from `docs/browser-ai-testcases.md` runs; failing viewports are noted per fix and must be re-tested at exactly those sizes (chrome-devtools `emulate` tool, e.g. `viewport: "390x844x3,mobile,touch"`).

---

### Task 1: Fix the three hydration mismatches on /events/detail/[slug]

**Files:**
- Modify: `src/app/events/detail/[slug]/event-detail-client.tsx:149-154`
- Modify: `src/app/events/detail/[slug]/team-matchup-hero.tsx` (formatKickoff ~65-75, kickoff spans ~204-211, MatchCountdown ~110-145)

Diagnosed root causes (dev-mode hydration diffs captured 2026-06-12):

**(1) All Outcomes collapse state** — `event-detail-client.tsx:149-154` runs `matchMedia` in the `useState` initializer; server renders `true`, client <1024px renders `false` → `<Collapsible>` text/attribute mismatch (fires deterministically below the `lg` breakpoint on multi-outcome events).

**(2) Kickoff time locale** — `team-matchup-hero.tsx` `formatKickoff` uses `d.toLocaleTimeString(undefined, …)` / `toLocaleDateString(undefined, …)`; SSR locale/timezone (Workers = UTC) differs from the visitor's → text mismatch at ALL widths on sports-matchup events.

**(3) Countdown** — `MatchCountdown` uses `useNow()` whose state seeds `Date.now()` at render; server snapshot vs hydration-time recompute differ whenever a minute boundary is crossed, and the label can structurally flip (`STARTS IN …` ↔ `LIVE`).

- [x] **Step 1: Fix the collapse-state initializer**

Replace in `event-detail-client.tsx` (current lines 149-154):

```tsx
  const [isOutcomeTableExpanded, setIsOutcomeTableExpanded] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(min-width: 1024px)").matches; // Tailwind 'lg' breakpoint
    }
    return true; // Default to expanded for SSR
  });
```

with an SSR-stable initial value reconciled before paint:

```tsx
  // Must match the server-rendered value (true) on the first client render,
  // or hydration fails below the lg breakpoint; the real viewport check runs
  // pre-paint after mount.
  const [isOutcomeTableExpanded, setIsOutcomeTableExpanded] = useState(true);
  useLayoutEffect(() => {
    setIsOutcomeTableExpanded(window.matchMedia("(min-width: 1024px)").matches);
  }, []);
```

Add `useLayoutEffect` to the React import.

- [x] **Step 2: Fix the kickoff locale spans**

In `team-matchup-hero.tsx`, add `suppressHydrationWarning` to the JSX elements that render `kickoff.time` (~line 204-206) and `kickoff.day` (~line 211) — locale/timezone-formatted timestamps must be viewer-local, so the standard React escape hatch applies:

```tsx
        <span
          suppressHydrationWarning
          className="font-mono text-xs sm:text-sm tabular-nums font-semibold text-foreground"
        >
          {kickoff.time}
        </span>
```

(Apply the same attribute to the `kickoff.day` element. Check the file for any OTHER `toLocale*`-rendered text nodes and treat them the same.)

- [x] **Step 3: Mount-gate the countdown**

`suppressHydrationWarning` only covers single text nodes, not the `STARTS IN…` ↔ `LIVE` structural flip, so the countdown must not SSR a ticking value. In `MatchCountdown` (~110-145): add a mounted flag and render the deterministic fallback until mounted:

```tsx
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
```

and where the label renders, gate it: until `mounted`, render the same static element with a deterministic placeholder (empty string or the kickoff day — read the JSX and keep the element structure identical to the post-mount shape so only TEXT changes after mount, never structure). Do NOT remove `useNow` — just don't let its first server/client values disagree visibly.

IMPORTANT: this is a LEAF mount-guard on a text label — it must NOT return `null` for any wrapper (that pattern previously broke app-wide SSR).

- [x] **Step 4: Gates**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm biome check src` — all green.

- [x] **Step 5: Verify in dev mode (full hydration errors)**

The owner's dev server may be on 8000 — use it READ-ONLY if up (`curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/`); otherwise start your own with `pnpm next dev -p 8001`. With chrome-devtools (ToolSearch "select:mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page,...__emulate,...__list_console_messages,...__new_page,...__wait_for"):
1. `emulate` `390x844x3,mobile,touch` → load a multi-outcome event (find one via `/markets`, e.g. `world-cup-winner`) → console must have ZERO hydration errors (dev prints full text, grep for "Hydration"/"hydration").
2. `emulate` `1440x900x2` → load a sports matchup event (slug from `/events/sports/live`, e.g. with a `-vs-`/league prefix) → zero hydration errors across 2 reloads.
3. Confirm the All Outcomes section still collapses on mobile and expands on desktop AFTER paint (the behavior must survive, only the first-render value changes).
If you started a server on 8001, kill it.

- [x] **Step 6: STOP — do not commit.**

---

### Task 2: Sports-live layout majors (TOTAL column clipping + trade bar under bottom nav)

**Files:**
- Modify: `src/components/sportsbook/event-rows.tsx` (row container `overflow-hidden`, SpreadCell/TotalCell column widths ~387/404)
- Modify: `src/app/globals.css` (`.sportsbook-event-row`, `event-grid-live`/`event-grid-scheduled` grid templates ~587-593)
- Modify: the mobile trade bar component (grep `DISMISS` in `src/components/sportsbook-view.tsx` / `src/app/events/sports/live/` to locate the `fixed bottom-0 ... z-50` bar)

**Finding A:** at 1440×900 desktop the price-button cluster needs ~672-708px but the row gets 632px with `overflow-x: hidden` → TOTAL buttons clipped ~40px, unreachable. Fine at ≥1512px.
**Finding B:** on mobile the trade bar (`fixed bottom-0 … z-50`) renders under `BottomNav` (`fixed bottom-0 … z-50 h-14`, `src/components/bottom-nav.tsx:64`); `elementFromPoint` on TRADE/DISMISS hits nav items.

- [x] **Step 1: Reproduce A, then fix the grid math**

Start a prod server if one isn't running (`pnpm next build && pnpm next start -p 8001`; NEVER while a dev server shares `.next`). `emulate` `1440x900x2`, open `/events/sports/live`, evaluate on a row: `(()=>{const r=document.querySelector(".sportsbook-event-row");return {rowW:r.clientWidth,need:r.scrollWidth};})()` → confirm `need > rowW`.

Fix approach (apply, then re-measure): make the markets column fit at ≥1280px by tightening the fixed-width cells and gaps — in `event-rows.tsx` reduce `SpreadCell` wrapper `w-[132px]` → `w-[112px]` and `TotalCell` wrapper `w-[122px]` → `w-[104px]`, and reduce the cluster's `gap-*` by one step; if still overflowing at 1440, adjust the `event-grid-live` grid template in `globals.css` (give the markets column a larger fraction / reduce the teams column min). Acceptance: `need <= rowW` at viewport widths 1280, 1440, 1512; buttons fully visible (screenshot); no wrap-induced row-height jumps; mobile/tablet unchanged.

- [x] **Step 2: Fix B — lift the trade bar above the bottom nav**

Locate the mobile trade bar. Change its positioning so it sits ABOVE the nav instead of under it: replace `bottom-0` with `bottom-14` (the nav is `h-14`) and raise stacking to `z-[60]`, keeping the existing safe-area padding on the NAV only (the bar now rests on top of the nav, not the screen edge):

```tsx
className="fixed bottom-14 left-0 right-0 z-[60] ..."
```

(Adapt to the actual classes; if the bar has its own `safe-area-pb`, remove it — the nav below already handles the safe area.)

Acceptance (prod build, `emulate` `390x844x3,mobile,touch`, open `/events/sports/live`, tap a price button): evaluate `document.elementFromPoint(x,y)` at the centers of TRADE and DISMISS → must return those controls, not nav items; bar fully visible above the nav (screenshot); DISMISS hides the bar.

- [x] **Step 3: Gates + kill any server you started. STOP — no commit.**

---

### Task 3: Trade widget hardening (?shares=abc NaN + sign/spacing cosmetics)

**Files:**
- Modify: `src/app/events/detail/[slug]/event-detail-client.tsx:122-131` (shares param parsing)
- Modify: `src/components/trading-form.tsx:614-627` (profit/return templates)

- [x] **Step 1: Guard the shares param**

Current (~129-131): `const initialShares: number | undefined = urlShares ? Number.parseFloat(urlShares) : undefined;` — `"abc"` becomes `NaN` and pollutes the form (renders `Return if YES $NaN`, `SLIPPAGE -100.00%`).

Replace with:

```tsx
  const parsedShares = urlShares ? Number.parseFloat(urlShares) : Number.NaN;
  const initialShares: number | undefined =
    Number.isFinite(parsedShares) && parsedShares > 0
      ? parsedShares
      : undefined;
```

(`undefined` falls back to the form's default of 10 — verify by reading where `initialShares` is consumed.)

- [x] **Step 2: Fix sign placement and spacing in the profit row**

In `trading-form.tsx` (~614-627) the profit renders `${value.toFixed(2)}` → negative shows `$-1.69`, and `({percent}%)` directly abuts the number. Build the string sign-first and add a space:

```tsx
  const profit = calculations.potentialWin - calculations.total;
  // Owner rule: no "+" on gains; losses render -$X.XX (sign before the $).
  const profitLabel = `${profit < 0 ? "-" : ""}$${Math.abs(profit).toFixed(2)}`;
```

```tsx
  <span className="v tabular-nums">
    {profitLabel}
    {calculations.total > 0 && (
      <span className="ret"> ({calculations.returnPercent}%)</span>
    )}
  </span>
```

Apply the same space-before-paren to the "Return if YES $6.50(482.4%)" row if it has the same pattern.

- [x] **Step 3: Gates. Verify on a prod or dev server:** `{slug}?shares=abc&outcome=banana` shows shares=10 and no `NaN` anywhere (`document.body.innerText.match(/NaN/)` → null); `?side=SELL&shares=10&outcome=yes` preselect still works; a negative-profit scenario shows `-$X.XX (Y%)`. STOP — no commit.

---

### Task 4: Tag-page infinite-scroll duplicate at page boundary

**Files:**
- Investigate: `src/hooks/use-paginated-events.ts:112-171` and the server route `src/app/api/events/paginated/route.ts`
- Modify: whichever side owns the off-by-one (likely the server's `after_cursor` handling) + add client-side dedupe as defense

Finding: on `/events/politics` (and other tags) the LAST item of page N repeats as the FIRST item of page N+1 (verified by slug at indices 19/20). `/markets` showed no dupes in 60 rows — compare what differs (different hook/params?).

- [x] **Step 1: Reproduce against the API directly**

```bash
curl -s "http://localhost:8001/api/events/paginated?limit=20&closed=false&order=volume24hr&ascending=false&tag_slug=politics" | python3 -c "import sys,json; d=json.load(sys.stdin); print([e['slug'] for e in d['data']][-1]); print(d['pagination']['nextCursor'])"
# then request page 2 with after_cursor=<nextCursor> and compare its FIRST slug to page 1's LAST slug
```

(Adapt param names to what `use-paginated-events.ts` actually sends — read it first. Confirm whether the overlap is server-side (cursor inclusive) or client-side.)

- [x] **Step 2: Fix at the source**

If server-side: in `src/app/api/events/paginated/route.ts`, find how `nextCursor` is derived and how `after_cursor` filters — make the cursor EXCLUSIVE (skip the cursor item itself) or advance the offset by the full page size. Show before/after of the exact lines in your report. If the upstream Gamma API owns the bug and we just proxy, fix in the route by dropping the first item of a page when it equals the cursor item.

- [x] **Step 3: Add client-side dedupe as defense-in-depth**

In `use-paginated-events.ts`, where pages flatten into the rendered list (find the `useMemo`/select that concatenates `pages`), dedupe by `id` (or `slug`):

```ts
  const seen = new Set<string>();
  const events = pages.flatMap((p) => p.events).filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
```

(Adapt to the actual shape; if dedupe already exists for /markets, extend it to the tag path.)

- [x] **Step 4: Gates + browser check:** `/events/politics`, scroll two pages, collect slugs via evaluate → no duplicates; end-of-list message intact. STOP — no commit.

---

### Task 5: Leaderboard + profile polish

**Files:**
- Investigate/Modify: `src/app/leaderboard/leaderboard-content.tsx` + the leaderboard table component (find it: grep `leaderboard-row`)
- Modify: `src/app/profile/[address]/page.tsx`

- [x] **Step 1: INVESTIGATE the scroll-jump (do not assume)**

`leaderboard-content.tsx:213` already passes `{ scroll: false }`, yet changing Period/Rank-By scrolled 400→0 in testing. Find the real cause: (a) check for OTHER `router.push`/`replace` calls in the dropdown handlers missing the option; (b) check whether the content re-mounts on param change (e.g. a `key` tied to searchParams, or the page component reading `searchParams` server-side and re-rendering the tree); (c) check for `window.scrollTo`/`scrollIntoView` calls. Reproduce on a prod server (8001): set `scrollY=400`, change Period, measure. Fix whatever the actual cause is and show the diff. If the cause is a full server-component re-render by design, switching the handlers to `useRouter().replace(..., { scroll: false })` on a client boundary or managing the param via `useSearchParams` + shallow state is the expected shape — pick the minimal change that keeps URL params working.

- [x] **Step 2: Cosmetics batch in the leaderboard table**

1. Address sub-label casing: render truncated addresses lowercase consistently (find the uppercase variant — likely a `.toUpperCase()` or CSS `uppercase` on the sub-label when a username exists; make both paths lowercase `0xf031...c80c`).
2. Copy-address button: add `aria-label="Copy address"`.
3. Category tabs: add `aria-pressed={isActive}` (or `aria-current` if links).

- [x] **Step 3: Profile fixes**

1. Document title: in the profile client component add
```tsx
  useEffect(() => {
    if (profile) document.title = `${displayName} | Knoww`;
    return () => {
      document.title = "Knoww — Prediction markets for every opinion";
    };
  }, [profile, displayName]);
```
(Adapt `displayName` to the actual variable; if the page has a server wrapper that can `generateMetadata`, prefer that.)
2. Minus-orphan wrap at 390px: add `whitespace-nowrap` to the rankings P&L value span (the one rendering `−$95.77K`).
3. X-link data: the render code exists (`page.tsx:231-239`, gated on `profile.xUsername`). Check the API/profile fetch path — if the leaderboard row has a handle for the same address but the profile response lacks `xUsername`, trace where the profile API builds its response (`src/app/api/profile/[address]/route.ts`) and include the field if it's available there. If the data genuinely isn't available on that endpoint, document as upstream-data limitation in your report and move on (timebox: 20 min).

- [x] **Step 4: Gates + browser check:** leaderboard scrollY preserved on dropdown change; lowercase addresses; profile title updates; no minus orphan at 390px. STOP — no commit.

---

### Task 6: Whales + backtest fixes — **SKIPPED (owner decision 2026-06-12: do not execute this task)**

**Files:**
- Modify: `src/app/whales/_components/whale-hero.tsx:23-31`
- Modify: `src/lib/rpc.ts:240`
- Modify: `src/app/whales/backtest/backtest-client.tsx`

- [ ] **Step 1: Clamp the negative data age**

`formatAge` in `whale-hero.tsx` renders "-3s" when the timestamp is slightly in the future. Clamp:

```tsx
function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  // ...rest unchanged
}
```

- [ ] **Step 2: Serialize the RPC error log**

`src/lib/rpc.ts:240` logs `{ error: err }` which prints `[object Object]`. Match the codebase's existing pattern (grep how other `log.error` calls serialize — many pass `{ error: err }` and the logger handles Errors; here `err` may be a non-Error object). Change to:

```ts
log.error("deployment.check_failed", {
  error: err instanceof Error ? err.message : String(err),
});
```

- [ ] **Step 3: Backtest fixes (four)**

In `backtest-client.tsx`:
1. **Mobile table clipping**: wrap the per-archetype and per-market results tables in `<div className="overflow-x-auto">…</div>` (rows extended to x≈484 on a 390px viewport with no internal scroll). Verify page-level `scrollWidth` stays 390 after.
2. **`+0.0¢` no-plus violation**: find the mean-profit/share rendering — remove the `+` prefix for non-negative values (losses keep `-`). Show before/after.
3. **Empty flagged-trades table**: when the flagged list is empty, render a single muted row "No flagged trades in this run" instead of a header-only table.
4. **Run timeout**: the run fetch (~51-78) has no timeout — a default 30-market run hung >12 minutes. Add an `AbortController` with a 5-minute timeout and a sanitized error state:

```tsx
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60_000);
  try {
    const res = await fetch(`/api/whales/backtest?${params}`, {
      signal: controller.signal,
    });
    // ...existing handling
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      setError("Backtest timed out — try fewer markets.");
    } else {
      setError("Backtest failed");
    }
  } finally {
    clearTimeout(timeout);
  }
```

(Adapt to the existing state names/structure; keep the existing "Backtest failed" sanitized path.) The SERVER-side hang itself (30 markets never returning) is upstream-heavy work — investigate-only: note in your report what `/api/whales/backtest` does per market and where the time goes; do NOT attempt a server rewrite.

- [ ] **Step 4: Gates. STOP — no commit.**

---

### Task 7: Formatting & copy batch

**Files:**
- Modify: `src/lib/formatters.ts:6-13` (+ its test `src/lib/formatters.test.ts`)
- Modify: `src/app/events/detail/[slug]/event-detail-client.tsx:530-531` + `outcomes-table.tsx` (probability display)
- Modify: `src/components/sportsbook-view.tsx:709` + `src/app/events/[tag]/tag-events-content.tsx:284` (league-label casing)
- Modify: `src/app/page.tsx` (Chrome Store links)
- Modify: `src/app/search/page.tsx` (clear handler)
- Modify: `src/components/comments/comment-item.tsx:98`
- Locate+Modify: the "ALL N MARKETS SHOWN" template (grep -ri "markets shown" src)

- [x] **Step 1: formatVolume billions tier (TDD)**

Add to `src/lib/formatters.test.ts`:

```ts
describe("formatVolume", () => {
  it("renders a billions tier", () => {
    expect(formatVolume(2_048_910_000)).toBe("$2.05B");
  });
  it("keeps millions under 1B", () => {
    expect(formatVolume(999_000_000)).toBe("$999.00M");
  });
});
```

Run (expect FAIL: renders `$2048.91M`), then add the tier in `formatVolume` ABOVE the millions check:

```ts
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
```

Run again (PASS). Check existing tests for formatVolume — adjust none (no existing expectation covers ≥1B; if one does, read it and reconcile).

- [x] **Step 2: Sub-1% probabilities render "<1%"**

`event-detail-client.tsx:530-531` rounds with `.toFixed(0)` so 0.4% → "0%". Keep the numeric field as-is (other math may use it) and fix at DISPLAY time: in `outcomes-table.tsx`, where `{market.yesProbability}%` renders (lines ~1103, 1164, 1330), use a tiny helper added to the same file (or `chart-range.ts` if cleaner):

```tsx
function formatProbability(pct: number, yesPrice?: string): string {
  const raw = yesPrice ? Number.parseFloat(yesPrice) * 100 : pct;
  if (raw > 0 && raw < 1) return "<1%";
  return `${pct}%`;
}
```

and replace the three render sites with `formatProbability(market.yesProbability, market.yesPrice)` (verify the actual prop names by reading the rows; if `yesPrice` isn't in scope at a site, fall back to `pct === 0` heuristics only where the raw price IS available — don't fabricate).

- [x] **Step 3: League label casing in empty states**

`sportsbook-view.tsx:709` renders `No active {labelText} markets right now.` with lowercase slugs ("nfl"). Uppercase short league codes at the source of `labelText` (read where it's derived; apply `labelText.length <= 4 ? labelText.toUpperCase() : capitalize first letter`). Same treatment for `tag-events-content.tsx:284` `${tagLabel}`.

- [x] **Step 4: "ALL 1 MARKETS SHOWN" pluralization**

`grep -rin "markets shown" src` to locate (it exists — observed on `/events/prince-andrew`). Fix singular: `ALL ${n} ${n === 1 ? "MARKET" : "MARKETS"} SHOWN`.

- [x] **Step 5: Landing Chrome Store links open in new tab**

In `src/app/page.tsx`, every `<a href={CHROME_STORE_URL}` (lines ~91, 155, 246 + any others — grep) gets `target="_blank" rel="noopener noreferrer"`. Internal links unchanged.

- [x] **Step 6: Search clear syncs the URL**

In `src/app/search/page.tsx`, the clear handler empties the input but leaves `?q=` in the URL (reload resurrects it). In `handleClear`, also replace the URL: `router.replace("/search", { scroll: false })` (import `useRouter` if absent; keep the focus-restore behavior).

- [x] **Step 7: Comment author identifier guard**

`comment-item.tsx:98` trusts `displayUsernamePublic`, which leaked `0x8ee8…AE98-1776825842149`. Guard address-like names:

```tsx
const rawName = comment.profile?.displayUsernamePublic;
const displayName =
  rawName && !/^0x[0-9a-fA-F]{40}/.test(rawName)
    ? rawName
    : formatAddress(comment.author);
```

- [x] **Step 8: Gates (vitest count grows by the formatVolume tests). STOP — no commit.**

---

### Task 8: 12px readability floor on app screens

**Files:**
- Modify: `src/app/globals.css`

The test spec (`docs/browser-ai-testcases.md` Typography section) requires: no rendered text below 12px computed on app screens; micro-labels authored at 8-11px must COMPUTE to 12px via a "global readability layer". No such layer exists — sweeps found 9-11px text everywhere (9px "new" badge on /markets, 10-11px chips/labels/avatars across markets/detail/sports/whales). The landing page (`.kw-landing`) is exempt.

- [x] **Step 1: Inventory the authored sizes**

`grep -roh "text-\[\(8\|9\|10\|11\)px\]" src --include="*.tsx" | sort | uniq -c` — list which arbitrary sizes exist and roughly how many call sites (expect text-[9px], text-[10px], text-[11px]; also check `text-2xs`-style custom utilities in globals.css).

- [x] **Step 2: Add the readability layer**

In `globals.css`, after the base layers, add a scoped floor (CSS only — zero TSX churn). The app content does NOT live under `.kw-landing`; scope by excluding it:

```css
/* ===== READABILITY FLOOR =====
   App screens never render text below 12px; micro-labels authored at
   8-11px compute to 12px. Landing (.kw-landing) keeps its editorial scale. */
body :is(.text-\[8px\], .text-\[9px\], .text-\[10px\], .text-\[11px\]):not(.kw-landing *) {
  font-size: 12px !important;
}
```

(Verify the escaped-bracket selector matches Tailwind v4's generated class names — test in the browser with `document.querySelector('.text-\\[9px\\]')`. If the project also has custom utilities like `text-2xs`, include them. If letter-spacing on uppercase micro-labels looks cramped after the bump, the spec's 0.08em tracking already applies via existing classes — do not change tracking.)

- [x] **Step 3: Visual verification (this is the risky change — be thorough)**

Prod build on 8001. Run the sweep script from the campaign on `/markets`, `/events/detail/[slug]`, `/events/sports/live`, `/whales` at 390 and 1440:

```js
() => { const v=[]; document.querySelectorAll("body *").forEach(el=>{ if(!el.offsetParent&&el.tagName!=="BODY")return; const t=(el.childNodes&&[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())); if(!t)return; const fs=parseFloat(getComputedStyle(el).fontSize); if(fs<12) v.push({tag:el.tagName,cls:String(el.className).slice(0,60),fs}); }); return v.length; }
```

Expected: 0 (or near-0 — investigate every remainder; icon-only elements without text are fine). Then SCREENSHOT each page at both sizes and compare against pre-change screenshots: no overlapping text, no broken chips/badges, no card overflow, no clipped table cells. The landing page sweep stays exempt (verify a 10px landing element still computes 10px). If a specific component genuinely breaks (text escaping a fixed-height badge), fix THAT component's box (e.g. `h-4` → `h-5`) rather than weakening the floor — list every such adjustment.

- [x] **Step 4: Gates. STOP — no commit.**

---

### Task 9: Heading hierarchy — exactly one h1 per page

**Files:**
- Modify: `src/app/search/page.tsx`, `src/app/leaderboard/leaderboard-content.tsx`, `src/app/profile/[address]/page.tsx`, `src/app/events/[tag]/tag-events-content.tsx`, `src/app/events/sports/live/page.tsx` (+ `[sport]` if shared), `src/app/portfolio/page.tsx`, `src/app/whales/page.tsx`
- Possibly: the shared `ProductHero` component (find it: grep "ProductHero" src/components)

Pages with `h1` count 0: /search, /leaderboard, /profile, /events/[tag], sports live + sport pages, /portfolio, /whales. Pages already correct: /, /markets, /privacy, event detail, backtest.

- [x] **Step 1: Check ProductHero first**

Several pages render their visual title through `ProductHero`. Read it: if it renders the page title as a `div`/`h2`, change THAT element to `h1` (one fix covers leaderboard/profile/whales/portfolio at once). Verify it isn't also used on pages that already have an h1 (grep usages) — if it is, add a `headingLevel` prop defaulting to `h1` and pass `h2` at the conflicting call site. Keep styling identical (`className` unchanged).

- [x] **Step 2: Per-page fixes for the rest**

- `/search`: the page's first visible element is the query section; add an `sr-only` h1: `<h1 className="sr-only">Search markets</h1>` at the top of the main container (the visible "§ Recently Viewed" h2s stay).
- `/events/[tag]`: promote the tag hero title element to `h1` (read `tag-events-content.tsx`, keep classes).
- `/events/sports/live` + `[sport]`: the "LIVE"/league section headers are h2 by design; add `sr-only` h1 with the page name (`Live sports markets` / `{league} markets`).
- Verify each changed page still has its OTHER headings in order (h1 → h2 → h3, no skips introduced).

- [x] **Step 3: Gates + quick sweep:** on each touched page evaluate `document.querySelectorAll("h1").length === 1`. STOP — no commit.

---

### Task 10: A11y batch + final verification

**Files:**
- Modify: `src/app/search/page.tsx` (recent-search remove buttons), the markets search input, shares stepper inputs in `trading-form.tsx`, backtest number inputs, `src/components/league-rail.tsx` (aria-current)

- [x] **Step 1: Accessible names + form field ids**

1. Recent-search remove buttons (`/search`): `aria-label={`Remove ${query} from recent searches`}`.
2. Markets/header search inputs flagged "form field should have an id or name": add `name="q"` (or an `id` + matching `label`/`aria-label`) to each flagged input — markets header search, /search query input, shares stepper inputs (`trading-form.tsx`), backtest inputs (`backtest-client.tsx`). Find them all: the DevTools issue counted 4 on /markets, 1 on /search, 2-3 in trading/backtest forms.
3. League rail (`league-rail.tsx`): add `aria-current="page"` to the active item.

- [x] **Step 2: Full gates + build**

```bash
pnpm tsc --noEmit && pnpm vitest run && pnpm biome check src
rm -rf .next && pnpm next build
```
All green; record the route table (sizes should be within a few kB of plan-4 numbers; the CSS floor adds ~0.1 kB).

- [x] **Step 3: Targeted re-verification of EVERY fixed finding** (prod server on 8001, chrome-devtools `emulate`):

| Fix | Re-test |
|---|---|
| Hydration (Task 1) | PROD build: multi-outcome detail at 390 + sports matchup at 1440, 2 reloads each → zero console errors (minified #418 absent) |
| TOTAL clipping (Task 2) | sports live at 1440x900 → all TOTAL buttons fully visible |
| Trade bar (Task 2) | 390 mobile → elementFromPoint hits TRADE/DISMISS |
| NaN shares (Task 3) | `?shares=abc` → no NaN, shares=10 |
| Pagination (Task 4) | /events/politics 3 pages → zero duplicate slugs |
| Leaderboard scroll (Task 5) | scrollY preserved on Period change |
| Whales age (Task 6) | refresh repeatedly → never negative |
| Backtest (Task 6) | mobile 390: tables scroll internally; flagged-empty shows message |
| formatVolume (Task 7) | detail header shows `$2.05B`-style for >1B events |
| <1% (Task 7) | sub-1% outcome shows `<1%` not `0%` |
| Copy/casing (Task 7) | NFL empty state uppercase; singular "MARKET" grammar; comment names formatted |
| CTAs (Task 7) | landing Chrome Store links have target=_blank |
| Search clear (Task 7) | clear → URL `/search` (no q param) |
| 12px floor (Task 8) | sweep returns 0 on /markets, detail, sports, whales; landing exempt |
| h1 (Task 9) | each page reports exactly 1 |
| a11y (Task 10) | no "form field" DevTools issues on /markets and /search; remove buttons named |

Kill the 8001 server when done. Report results per row. STOP — no commit.

---

## Deliberately out of scope (documented, not fixed)

- Backtest server-side runtime (30-market hang) — investigate-only note in Task 6; server rewrite is its own project.
- Profile soft-404 HTTP status — profile data is client-fetched; returning a real 404 needs a server-side fetch refactor. Disproportionate; documented.
- Leaderboard "$0.00 volume with large P&L" rows and the "352 MKTS" sports count — upstream data quirks, not display bugs.
- Recent searches persisting only on result click — works as designed.
- Privacy TOC italic numerals — allowed editorial typography per owner convention.
- Image-URL signing SSR/client divergence — intentional (server-only signing key), does not throw.

## Self-review notes

- Coverage vs findings list: hydration → T1; sports majors → T2; NaN/cosmetics → T3; duplicate → T4; leaderboard/profile → T5; whales/backtest → T6; formatting+copy (volume B-tier, <1%, league casing, pluralization, CTAs, search-clear, comment names) → T7; 12px floor → T8; h1s → T9; a11y + final sweep → T10. Out-of-scope items listed with reasons.
- Investigate-first items are explicit recipes with acceptance criteria (T2 grid math, T4 cursor, T5 scroll-jump, T7 Step 4 locate-string) — no placeholder fixes.
- Risk callouts: T1 Step 3 leaf-guard warning (no wrapper nulls — that pattern broke SSR before); T8 is the visual-blast-radius change and carries its own screenshot protocol; T2 Step 1 measures before and after.
- Line numbers are anchors from 2026-06-12 recon; re-locate by symbol/grep if drifted.
