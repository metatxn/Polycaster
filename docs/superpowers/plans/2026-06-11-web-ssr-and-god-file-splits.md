# Web SSR Fix + God-File Splits Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **OWNER OVERRIDE — NO COMMITS:** The repo owner commits manually. Never run `git add` or `git commit`. Leave all changes uncommitted. Wherever a workflow would normally commit, simply stop after tests pass.

**Goal:** Restore server-side rendering of body HTML across the entire app by removing the AccentColor feature outright (its provider's mounted guard is the root cause, and the owner has decided the feature is not needed), then split the four remaining god files (`live-sportsbook.tsx` 3,020 lines, `agent-dashboard-client.tsx` 2,087, `event-detail-client.tsx` 1,987, `use-clob-client.ts` 1,090) into focused modules without changing any public API or behavior, plus three small consolidation follow-ups left over from plan 3.

**Architecture:** Task 1 is a clean feature removal (provider, picker UI, CSS, storage) with app-wide SSR verification. Tasks 2–6 are mechanical extractions: move clusters of symbols into new sibling modules, keep every existing import path working via re-exports from the original file, and keep all hook/component public APIs byte-compatible. Nothing gets redesigned; trading-critical state machines (`createOrder`, approval flows) deliberately stay where they are.

**Tech Stack:** Next.js 15 App Router (dynamic SSR on all routes), React 19, TanStack Query, wagmi v2, vitest (jsdom, globals), biome, pnpm workspace. App dir: `apps/web`.

**Working directory for all commands:** `/Users/nareshkatta/Desktop/Soclly/polycaster/apps/web` unless stated otherwise.

**Verification gates used by every task** (run all, expect all green):
```bash
pnpm tsc --noEmit          # typecheck, expect exit 0
pnpm vitest run            # expect all suites pass (135+ tests as of plan 3)
pnpm biome check src       # expect 0 errors (19 pre-existing globals.css warnings are the accepted baseline)
```

---

## Context for implementers with zero codebase history

- This is a prediction-markets product ("Knoww"). `apps/web` deploys to Cloudflare Workers via @opennextjs/cloudflare. Every page route is dynamically rendered (the root layout awaits `headers()`).
- **Diagnosed 2026-06-11:** the app has NEVER served body HTML. `apps/web/src/context/color-theme-context.tsx` has `if (!mounted) return null;` in `AccentColorProvider`, which wraps the whole app via `ContextProvider` (`src/context/index.tsx`) in the root layout. `mounted` is always `false` on the server, so SSR silently emits an empty body; the client renders everything from the RSC flight payload. Head metadata/OG/JSON-LD are unaffected.
- **Owner decision (2026-06-11):** the accent-color feature is not needed — remove it entirely rather than fixing the guard. The base-theme picker (light/dark/midnight/etc.) STAYS; only the accent-color sub-feature goes.
- Owner display rule (firm): **no `+` prefix on positive P&L values** — green text already signals positive. Losses keep `-`.
- Owner workflow rule (firm): **no git commits** — leave everything uncommitted.
- The dev server may be running on port 8000 (owner's). For production verification use port 8001. If `next start` fails with `Cannot find module './vendor-chunks/...'`, run `rm -rf .next && pnpm next build` (known stale-incremental-build issue) and retry.

---

### Task 1: Remove the AccentColor feature entirely (fixes app-wide SSR body HTML)

**Files:**
- Create: `src/lib/base-themes.ts` (the base-theme metadata currently co-located with accent code — it STAYS)
- Delete: `src/context/color-theme-context.tsx`
- Modify: `src/context/index.tsx` (remove the `AccentColorProvider` wrapper)
- Modify: `src/components/theme-toggle.tsx` (remove the accent picker section; repoint `BASE_THEMES` import)
- Modify: `src/app/globals.css` (remove all `[data-accent=...]` rule blocks, ~lines 128–235)

Why this fixes SSR: `AccentColorProvider` wraps the entire app and `return null`s until a client-side effect runs, so the server renders an empty body on every page. The owner has decided to delete the feature rather than fix the guard. Verification is runtime: after this task, every route must serve real body HTML.

There is no unit-testable artifact left after a deletion — the regression gate is the build + curl SSR sweep in Steps 6–7. Do not skip them.

- [x] **Step 1: Create `src/lib/base-themes.ts`**

The base-theme metadata is used by the theme picker and must survive. Create the file with this exact content (moved verbatim from `color-theme-context.tsx` lines 12–39):

```ts
// Base themes info (managed by next-themes, this is just metadata)
export type BaseTheme =
  | "light"
  | "dark"
  | "midnight"
  | "sunset"
  | "forest"
  | "ocean"
  | "lavender"
  | "slate"
  | "softpop";

export const BASE_THEMES: {
  value: BaseTheme;
  label: string;
  preview: string;
  isDark: boolean;
}[] = [
  { value: "light", label: "Light", preview: "#ffffff", isDark: false },
  { value: "dark", label: "Dark", preview: "#171717", isDark: true },
  { value: "midnight", label: "Midnight", preview: "#1a1a2e", isDark: true },
  { value: "ocean", label: "Ocean", preview: "#0d1b2a", isDark: true },
  { value: "slate", label: "Slate", preview: "#1e293b", isDark: true },
  { value: "softpop", label: "Soft Pop", preview: "#051414", isDark: true },
  { value: "sunset", label: "Sunset", preview: "#fef3e2", isDark: false },
  { value: "forest", label: "Forest", preview: "#ecfdf5", isDark: false },
  { value: "lavender", label: "Lavender", preview: "#f5f3ff", isDark: false },
];
```

- [x] **Step 2: Remove the provider from `src/context/index.tsx`**

Delete the import line `import { AccentColorProvider } from "@/context/color-theme-context";` and unwrap its children. The provider JSX block changes from:

```tsx
          <LazyMotion features={loadMotionFeatures} strict>
            <AccentColorProvider>
              <WalletProvider>
                <EventFilterProvider>
                  <OnboardingProvider>
                    <TradingProvider>{children}</TradingProvider>
                  </OnboardingProvider>
                </EventFilterProvider>
              </WalletProvider>
            </AccentColorProvider>
          </LazyMotion>
```

to:

```tsx
          <LazyMotion features={loadMotionFeatures} strict>
            <WalletProvider>
              <EventFilterProvider>
                <OnboardingProvider>
                  <TradingProvider>{children}</TradingProvider>
                </OnboardingProvider>
              </EventFilterProvider>
            </WalletProvider>
          </LazyMotion>
```

- [x] **Step 3: Remove the accent picker from `src/components/theme-toggle.tsx`**

1. In the import from `@/context/color-theme-context` (line ~15–18): the file imports `ACCENT_COLORS`, `BASE_THEMES`, and `useAccentColor`. Replace the whole import with `import { BASE_THEMES } from "@/lib/base-themes";`.
2. Delete the hook line `const { accentColor, setAccentColor } = useAccentColor();` (line ~23).
3. Delete the entire "Accent Color Section" JSX block (starts at the `{/* Accent Color Section */}` comment, line ~115; ends at that section's closing container tag — it is the block containing the `ACCENT_COLORS.map(...)` loop, roughly lines 115–135). Read the JSX carefully and remove the complete balanced element.
4. Remove any imports/variables that became unused.

- [x] **Step 4: Delete `src/context/color-theme-context.tsx`**

```bash
rm src/context/color-theme-context.tsx
grep -rn "color-theme-context\|useAccentColor\|useColorTheme\|ACCENT_COLORS\|AccentColorProvider\|ColorThemeProvider\|COLOR_THEMES" src
```
Expected: zero matches. (The legacy aliases `useColorTheme`/`ColorThemeProvider`/`ColorTheme`/`COLOR_THEMES` had no consumers — the grep proves it.)

- [x] **Step 5: Remove the `[data-accent]` CSS from `src/app/globals.css`**

The accent rules live in a contiguous region (~lines 128–235): six accent values (`violet`, `blue`, `emerald`, `rose`, `orange`, `cyan`), each with a light-mode block (`[data-accent="X"] { ... }`) and a dark-themes block (`.dark[data-accent="X"], .midnight[...], .ocean[...], .slate[...], .softpop[...] { ... }`). Delete every rule block whose selector contains `[data-accent`. Also delete any now-orphaned section comment directly above the region. Then verify:

```bash
grep -n "data-accent" src/app/globals.css
```
Expected: zero matches. Note: users' saved `knoww-accent-color` localStorage values simply become inert — no migration needed.

- [x] **Step 6: Run the verification gates**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm biome check src`
Expected: all green.

- [x] **Step 7: Build and verify SSR across all routes**

```bash
pnpm next build
pnpm next start -p 8001 > /tmp/plan4-task1-server.log 2>&1 &
sleep 5
for route in / /privacy /markets /leaderboard /search /whales /portfolio /events/sports/live; do
  count=$(curl -s --max-time 30 "http://localhost:8001$route" | python3 -c "import sys; html=sys.stdin.read(); pre=html.split('__next_f')[0]; body=pre[pre.find('<body'):]; print(len(body))")
  echo "$route pre-flight-body-bytes=$count"
done
cat /tmp/plan4-task1-server.log
```

Expected: every route reports pre-flight body bytes in the **thousands** (before this fix: ~600, just the theme script). The landing `/` should be ~200,000. The server log must contain **no error stacks / digests** — a route that crashes during SSR will show an error here AND fall back to a blank shell; if that happens, find the component accessing `window`/`localStorage` during render on that route and defer the access into a `useEffect` or behind `typeof window !== "undefined"`, then re-run this step.

Also verify one route by content: `curl -s http://localhost:8001/privacy | grep -c '<h2'` → expected ≥ 10.

- [x] **Step 8: Browser sanity check (chrome-devtools MCP)**

Navigate to `http://localhost:8001/` and `http://localhost:8001/markets`:
1. Zero console errors (especially no hydration mismatch warnings).
2. Open the theme toggle: the base-theme picker (Light/Dark/Midnight/…) works and there is NO "Accent Color" section anymore. Switch to a dark theme and back; the UI follows.
3. Toggle dark theme on the landing page, hard reload, confirm no white flash (the plan-3 `THEME_BOOT_SCRIPT` in `landing-shell.tsx` is now live because the body is server-rendered — verify it executes by checking `data-theme` on its parent element before interacting).

Then kill the port-8001 server: `kill $(lsof -ti :8001)`.

- [x] **Step 9: STOP — do not commit** (owner commits manually).

---

### Task 2: Split `use-clob-client.ts` into composable modules

**Files:**
- Create: `src/hooks/clob/shared.ts`
- Create: `src/hooks/clob/balances.ts`
- Create: `src/hooks/clob/market-data.ts`
- Create: `src/hooks/clob/shared.test.ts`
- Modify: `src/hooks/use-clob-client.ts` (1,090 lines → ~700)
- Must keep passing: `src/hooks/use-clob-client.test.tsx`

**Hard constraints:**
- The `useClobClient()` return object (23 properties) must not change — consumers are `use-open-orders.ts`, `use-sell-position.ts`, `components/trading/hooks/use-trading-form-state.ts`.
- The re-exports `Side`, `OrderType`, and type `CreateOrderParams` stay exported from `use-clob-client.ts`.
- **Deliberately NOT moving:** `createOrder`, `cancelOrder`, `ensurePusdSufficient`, `ensureV2Approvals`, `ensureSellCtfApproval`, `updateAllowance`, `getClient`, `canTrade`. These form the trading state machine (`operationStep`/`isLoading`/`error` interleaving) — moving them risks live-trading regressions for zero structural gain. Do not "improve" them.

- [x] **Step 1: Create `src/hooks/clob/shared.ts`**

Move these symbols verbatim from `use-clob-client.ts` (current locations noted; re-find by name if drifted): `parseRawUnits` (~lines 113–124), `isBalanceAllowanceError` (~126–136), `wait` (~138–140), type `ClobOperationStep` (~142–147), constants `DEFAULT_TRADING_APPROVAL_RAW` and `CLOB_BALANCE_SYNC_DELAYS_MS` (~101–105). Export all of them. Bring along exactly the imports those symbols need (`parseApprovalAmountRaw`, `DEFAULT_APPROVAL_AMOUNT` from `@knoww/shared-types/trading`). Do NOT move `CLOB_HOST` (it stays with `getClient`).

- [x] **Step 2: Write the failing test for shared utilities**

Create `src/hooks/clob/shared.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isBalanceAllowanceError, parseRawUnits } from "./shared";

describe("parseRawUnits", () => {
  it("passes bigints through", () => {
    expect(parseRawUnits(123n)).toBe(123n);
  });
  it("parses integer strings", () => {
    expect(parseRawUnits("1000000")).toBe(1000000n);
  });
  it("returns null for garbage", () => {
    expect(parseRawUnits("not-a-number")).toBeNull();
  });
});

describe("isBalanceAllowanceError", () => {
  it("detects balance/allowance failure messages", () => {
    expect(
      isBalanceAllowanceError(new Error("not enough balance / allowance"))
    ).toBe(true);
  });
  it("ignores unrelated errors", () => {
    expect(isBalanceAllowanceError(new Error("network timeout"))).toBe(false);
  });
});
```

**Before finalizing the test:** read the moved function bodies. If `parseRawUnits` returns a fallback other than `null` for garbage input, or `isBalanceAllowanceError` matches a different phrase, adjust the assertions to the ACTUAL current behavior — this test pins existing behavior, it does not redesign it.

- [x] **Step 3: Run the test**

Run: `pnpm vitest run src/hooks/clob/shared.test.ts`
Expected: PASS (the functions are moved, not changed; if it fails, your move broke something).

- [x] **Step 4: Create `src/hooks/clob/balances.ts`**

Move the four on-chain read operations out of the hook body into standalone async functions with explicit parameters (they currently close over hook scope). From the hook, move the bodies of: `readConditionalBalanceRaw` (~211–231), `getUsdcBalance` (~901–943), `getPusdBalance` (~952–989), `getUsdcAllowance` (~994–1026).

Signature pattern — each takes what it closed over as explicit args. Read each body first and lift exactly its free variables; expected shape:

```ts
export async function readConditionalBalanceRaw(
  ownerAddress: Address,
  tokenId: string
): Promise<bigint | null> { /* moved body */ }

export async function readUsdcBalance(address: Address): Promise<{
  raw: bigint;
  formatted: string;
}> { /* moved body */ }
// ...same for readPusdBalance, readUsdcAllowance
```

Keep the EXACT return shapes the hook currently produces (the hook's public `getUsdcBalance` etc. must return identical values). In `use-clob-client.ts`, the public `useCallback`s become thin wrappers that resolve the address from hook state and delegate, e.g.:

```ts
const getUsdcBalance = useCallback(async () => {
  if (!address) return null; // preserve the existing guard exactly as-is
  return readUsdcBalance(address);
}, [address]);
```

(Adapt the guard/return to whatever the current code does — behavior-preserving move, nothing more.)

- [x] **Step 5: Create `src/hooks/clob/market-data.ts`**

Same pattern for the read-only queries: move the bodies of `getOrderBook` (~748–755), `getOpenOrders` (~760–771), `isOrderScoring` (~1032–1046), `areOrdersScoring` (~1051–1064) into functions taking the client (and whatever else they reference) as parameters:

```ts
import type { UnifiedSdkTradingClient } from "@knoww/shared-types/polymarket-unified";

export async function fetchOpenOrders(
  client: /* the adapted legacy client type the hook uses */,
  /* ...other lifted params */
) { /* moved body */ }
```

The hook keeps thin `useCallback` wrappers that call `getClient()` + `canTrade` guard and delegate. The existing test `use-clob-client.test.tsx` mocks at the module boundary of the SDK (`adaptUnifiedSecureClientForLegacyClob` etc.), so it must pass **unchanged** — if you find yourself editing that test, you changed behavior; stop and re-do the move.

- [x] **Step 6: Slim `use-clob-client.ts`**

Replace moved code with imports from `./clob/shared`, `./clob/balances`, `./clob/market-data`. Result ≈ 700 lines. Public exports of the file unchanged: `Side`, `OrderType`, `CreateOrderParams`, `useClobClient`.

- [x] **Step 7: Run all gates**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm biome check src`
Expected: all green — especially `src/hooks/use-clob-client.test.tsx` passing without edits.

- [x] **Step 8: STOP — do not commit.**

---

### Task 3: Split `agent-dashboard-client.tsx`

**Files:**
- Create: `src/app/agent/types.ts`
- Create: `src/app/agent/panels.tsx`
- Create: `src/app/agent/decision-trail.tsx`
- Modify: `src/app/agent/agent-dashboard-client.tsx` (2,087 lines → ~900)

Only consumer is `src/app/agent/page.tsx` (default import) — nothing outside this directory imports anything from this file, so internal symbols can move freely.

- [x] **Step 1: Create `src/app/agent/types.ts`**

Move all 11 interfaces verbatim (current lines 28–277): `WatchlistItem`, `RunSummary`, `RunDetail`, `Metrics`, `CalibrationModelStat`, `CalibrationSummary`, `PortfolioPnl`, `LiveOrderRecordSummary`, `LiveExecutionConfigSummary`, `PositionSummary`, `AgentStatus`. Export all. No imports needed (they are plain shapes; verify and carry any type imports they reference).

- [x] **Step 2: Create `src/app/agent/panels.tsx`**

`"use client"` at top. Move verbatim: `Metric` (1195–1206), `LiveOrdersPanel` (1208–1346), `CountTile` (1348–1359), `LiveOrderRow` (1361–1448), `PositionsPanel` (1450–1535), `PositionCard` (1537–1596), `CalibrationPanel` (1598–1663), `StatusPill` (2068–2087). Export `Metric`, `LiveOrdersPanel`, `PositionsPanel`, `CalibrationPanel`, `StatusPill` (the ones the main component renders); keep `CountTile`, `LiveOrderRow`, `PositionCard` module-private. Import the types they use from `./types` and carry over the exact UI imports they reference (check each: `Decimal`, lucide icons, `Button`, `Table*` etc. — copy from the original import block only what these components actually use).

- [x] **Step 3: Create `src/app/agent/decision-trail.tsx`**

`"use client"` at top. Move verbatim: `EvidenceUsed` (1665–1761), `domainFromUrl` (1763–1769), `SearchDiagnostics` (1771–1898), `ResolutionBadge` (1900–1917), `VoteCorrectness` (1919–1954), `EdgeChip` (1956–1973), `EvidenceList` (1975–2003), `DebugRow` (2005–2012), `DebugBlock` (2014–2023), `RelatedMarkets` (2025–2066). Export the components that `AgentDashboardClient` renders directly (check its JSX — at minimum `EvidenceUsed`, `SearchDiagnostics`, `RelatedMarkets`, `ResolutionBadge`, `VoteCorrectness`, `EdgeChip`, `EvidenceList`, `DebugRow`, `DebugBlock`); keep `domainFromUrl` private.

- [x] **Step 4: Slim the main file**

`agent-dashboard-client.tsx` keeps: `emptyForm`, `AgentDashboardClient` (default-equivalent export — keep the exact current export form), imports from `./types`, `./panels`, `./decision-trail`. Remove now-unused imports.

- [x] **Step 5: Run gates + dev-render check**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm biome check src`
Expected: green.
Then: `pnpm next build` — expected: builds clean, `/agent` route present in the route table with a similar first-load size as before (this is a pure reshuffle; large size deltas mean you accidentally changed dynamic-import boundaries).

- [x] **Step 6: STOP — do not commit.**

---

### Task 4: Extract module-level seams from `event-detail-client.tsx`

**Files:**
- Create: `src/app/events/detail/[slug]/chart-range.ts`
- Create: `src/app/events/detail/[slug]/outcome-matching.ts`
- Create: `src/app/events/detail/[slug]/order-book-api.ts`
- Create: `src/app/events/detail/[slug]/use-chart-range-history.ts`
- Modify: `src/app/events/detail/[slug]/event-detail-client.tsx` (1,987 → ~1,400)

Only consumer is the sibling `page.tsx` (default import). **Deliberately staying put:** the component-internal selection/trading state, order-book seeding effects, and sports-cache effects — they are densely coupled to 50+ hooks in the component body; extracting them is high-risk surgery with low payoff. Do not attempt it.

- [x] **Step 1: Create `chart-range.ts`**

Move verbatim (current lines noted): `CANDIDATE_PALETTE` (134–140), `chartTimeRangeToStartTsOffset` (142–152), `chartTimeRangeToFidelity` (154–163), `computeAllRangeFidelity` (165–173), `getChartRangePriceHistoryRequest` (175–200), `isLiveSportsEventForChart` (202–221), `toDisplayPercentagePointChange` (264–276). Export all. Carry over their imports (`TimeRange` type from `@/components/market-price-chart`, the `Event` type from `@/hooks/use-event-detail` if referenced, `Decimal` if used).

Note: `field-tiles.tsx` line ~34 has a comment referencing `toDisplayPercentagePointChange` living in `event-detail-client.tsx` — update that comment to point at `chart-range.ts`.

- [x] **Step 2: Create `outcome-matching.ts`**

Move verbatim: `normalizeOutcomeName` (278–286), `getSportsRailActiveSlug` (288–340), `findOutcomeIndexFromUrl` (342–385), `matchupMoneylineRank` (387–407), `matchupMoneylineLabel` (409–418). Export all. Carry imports (`SPORT_GROUPS` from `@/lib/sport-categories`, `OutcomeData` type, etc. — copy only what these five reference).

- [x] **Step 3: Create `order-book-api.ts`**

Move verbatim: `MAX_MARKETS_WITH_REST_QUOTES` (104), types `BookSnapshot` (106–113), `PriceHistoryPoint` (115–117), `PriceHistoryBatchResponse` (120–126), `TradingPanelOrderBookSnapshot` (423–428), fetchers `fetchBookSnapshot` (223–231), `fetchBookSnapshots` (233–241), `fetchPriceHistoryBatch` (243–262). Export all. Carry imports (`fetchClobOrderBook`/`fetchClobOrderBooks` from `@knoww/shared-types/clob`, `CLOB_BASE_URL`).

- [x] **Step 4: Extract the chart price-history hook**

Create `use-chart-range-history.ts` containing a `useChartRangeHistory` hook. Mechanical recipe (the exact identifiers live in the component body, ~lines 1128–1219 pre-move):
1. Locate in `EventDetailClient`: the `chartRangeHistoryRequest` `useMemo`, the `chartRangePriceHistories` `useQuery`, and the `chartRangeChangeByTokenId` `useMemo`.
2. The hook's parameters are exactly the component-scope identifiers those three blocks reference (expected: the selected time range, the chart token id list / top chart markets, the event start date, and an enabled flag — confirm by reading).
3. The hook returns exactly the values the rest of the component consumes from those blocks (expected: the price-history query result and `chartRangeChangeByTokenId`).
4. Use the `qk` query-key factory exactly as the inlined `useQuery` does today — do not invent a new key spelling; move the existing one verbatim.
5. Replace the three blocks in the component with one hook call.

- [x] **Step 5: Update imports in `event-detail-client.tsx`**

Import the moved symbols from the three new modules + the new hook. Delete the now-unused imports from the original block. The default export and props of `EventDetailClient` are unchanged.

- [x] **Step 6: Run gates + build + live check**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm biome check src && pnpm next build`
Expected: green; `/events/detail/[slug]` first-load size within a few kB of the pre-task build (pure reshuffle).
Then with chrome-devtools on the owner's dev server (port 8000) or a port-8001 prod server: open any event detail page, switch chart time ranges (1H/1D/1W/ALL), confirm the chart redraws and the % change chips update, expand an outcome's order book, zero console errors.

- [x] **Step 7: STOP — do not commit.**

---

### Task 5: Split `live-sportsbook.tsx` — part 1: pure logic modules

**Files:**
- Create: `src/components/sportsbook/types.ts`
- Create: `src/components/sportsbook/league-region.ts`
- Create: `src/components/sportsbook/market-parsing.ts`
- Create: `src/components/sportsbook/format.ts`
- Create: `src/components/sportsbook/format.test.ts`
- Create: `src/components/sportsbook/dates.ts`
- Create: `src/components/sportsbook/use-market-position-lookup.ts`
- Modify: `src/components/live-sportsbook.tsx`

External consumers (only two: `src/app/events/sports/live/page.tsx`, `src/components/sportsbook-view.tsx`) import exactly: `buildSelectedMarket`, `findMoneyline`, `LiveSportsbook`, `ScheduledSportsbook`, and type `SelectedMarketInfo`. **These must keep resolving from `@/components/live-sportsbook` via re-exports — do not touch the consumer files.**

- [x] **Step 1: Create `sportsbook/types.ts`**

Move verbatim (line numbers from the pre-split file): `EventMarket` (54–73), `LiveEvent` (75–93), `ParsedBettingLine` (95–102), `MoneylineChoice` (104–108), `MoneylineDisplayData` (110–116), `SelectedMarketInfo` (118–133). Export all (including the previously-private ones — the split modules need them). Carry type-only imports (`LiveGameState` from `@/hooks/use-sports-websocket` if referenced).

- [x] **Step 2: Create `sportsbook/league-region.ts`**

Move verbatim: `LEAGUE_DISPLAY` (147–195), `GENERIC_TAGS` (197–205), `COUNTRY_TIME_ZONE_HINTS` (207–226), `COUNTRY_LEAGUE_PRIORITIES` (228–266), `extractCountryFromLocale` (268–271), `inferCountryCodeFromBrowser` (273–290), `useInferredCountryCode` (292–300), `eventTags` (302–306), `eventMatchesPriority` (308–329), `getLeagueRegionRank` (331–346), `sortLeagueEntriesForRegion` (348–361), `getLeagueFromTags` (363–376), `guessLeagueFromTitle` (378–388), `leagueDisplayName` (390–392). Export: `useInferredCountryCode`, `sortLeagueEntriesForRegion`, `getLeagueFromTags`, `leagueDisplayName` (plus whatever else later split files turn out to need — keep the rest private). `useInferredCountryCode` is a hook in a `.ts` file with no JSX — that's fine, but the file needs no `"use client"` because it's only imported by client components; add it anyway for clarity since it uses React hooks: put `"use client"` at top.

- [x] **Step 3: Create `sportsbook/market-parsing.ts`**

Move verbatim: `parseMarketOutcomes` (396–398), `parseMarketPrices` (400–402), `isResolvedPrice` (404–409), `isYesNoOutcomes` (411–415), `getOutcomeIndex` (417–420), `normalizeText` (422–428), `findDrawMarket` (430–448), `parseBettingLine` (450–457), `findYesNoLineForTeam` (459–489), `getFallbackTeamNames` (491–499), `buildMoneylineDisplayData` (501–638), `resolveOutcomeTokenIds` (640–660), `findMoneyline` (719–759), `findSpread` (761–852), `tryParseTotal` (854–869), `findTotal` (871–923), `normalizeTotal` (925–937), `teamAbbr` (939–949), `parseTeamsFromTitle` (951–962), `getSeriesInfo` (964–967), `getTournamentInfo` (969–972), `mapOutcomeNames` (974–996), `buildSelectedMarket` (998–1033). Export the ones used across module boundaries: `findMoneyline`, `buildSelectedMarket`, `mapOutcomeNames`, `buildMoneylineDisplayData`, `resolveOutcomeTokenIds`, `findSpread`, `findTotal`, `teamAbbr`, `parseTeamsFromTitle`, `getSeriesInfo`, `getTournamentInfo`, `parseMarketOutcomes`, `parseMarketPrices` (audit each remaining symbol's external use as you slim the main file; private if only used within this module). Imports: `parseGammaNumberArray`, `parseGammaStringArray`, `resolveNegRisk` from `@knoww/shared-types/polymarket`; types from `./types`.

- [x] **Step 4: Create `sportsbook/format.ts` and FIX the P&L plus-sign**

Move verbatim: `normalizePrice` (662–665), `toDecimal` (667–673), `formatUsd` (675–677), `formatSignedUsd` (679–683), `formatPositionPercent` (685–689), `resolveLivePrice` (691–709), `tokenIdForOutcome` (711–717). Export all. Imports: `Decimal` from `decimal.js`; types from `./types`.

**One deliberate behavior change** (owner display rule — no `+` prefix on positive P&L; green already signals positive; losses keep `-`). Replace `formatSignedUsd` with:

```ts
export function formatSignedUsd(value: number | string | undefined): string {
  const decimal = toDecimal(value);
  // Owner rule: no "+" on gains (green already signals positive); losses keep "-".
  const sign = decimal.lt(0) ? "-" : "";
  return `${sign}$${decimal.abs().toFixed(2)}`;
}
```

Apply the same rule to `formatPositionPercent` ONLY IF it also prepends `+` to positives (read it; current source at 685–689 — if it formats like `+5.2%`, drop the plus the same way; if it already has no plus, leave it).

- [x] **Step 5: Write the format test**

Create `src/components/sportsbook/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatSignedUsd, formatUsd } from "./format";

describe("formatSignedUsd", () => {
  it("does not prefix gains with +", () => {
    expect(formatSignedUsd(12.5)).toBe("$12.50");
  });
  it("keeps - on losses", () => {
    expect(formatSignedUsd(-3.2)).toBe("-$3.20");
  });
  it("treats zero as unsigned", () => {
    expect(formatSignedUsd(0)).toBe("$0.00");
  });
});

describe("formatUsd", () => {
  it("formats plain USD", () => {
    expect(formatUsd(7)).toBe("$7.00");
  });
});
```

(Check `formatUsd`'s actual output format first — if it adds separators or different precision, pin the actual behavior.)

Run: `pnpm vitest run src/components/sportsbook/format.test.ts`
Expected: PASS.

- [x] **Step 6: Create `sportsbook/dates.ts`**

Move verbatim: `parseGammaDate` (2587–2595), `getGameStartTime` (2597–2615), `formatStartTime` (2617–2643), `getLocalDateKey` (2645–2650), `formatDateHeading` (2652–2658), `formatRelativeTime` (2660–2667). Export all (sections and rows both use them). Types from `./types`.

- [x] **Step 7: Create `sportsbook/use-market-position-lookup.ts`**

`"use client"` at top. Move verbatim: `useMarketPositionLookup` (1035–1092). Export it. Imports: `useUserPositions`/`Position` from `@/hooks/use-user-positions`, `useProxyWallet` if referenced, types from `./types`.

- [x] **Step 8: Update `live-sportsbook.tsx` to import from the new modules**

Delete the moved code; add imports from `./sportsbook/types`, `./sportsbook/league-region`, `./sportsbook/market-parsing`, `./sportsbook/format`, `./sportsbook/dates`, `./sportsbook/use-market-position-lookup`. Add the public re-export block near the top so external consumers are untouched:

```ts
export type { LiveEvent, SelectedMarketInfo } from "./sportsbook/types";
export {
  buildSelectedMarket,
  findMoneyline,
  mapOutcomeNames,
} from "./sportsbook/market-parsing";
```

- [x] **Step 9: Run gates**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm biome check src`
Expected: green. File should now be ≈ 1,700 lines (components remain; part 2 moves them).

- [x] **Step 10: STOP — do not commit.**

---

### Task 6: Split `live-sportsbook.tsx` — part 2: component modules

**Files:**
- Create: `src/components/sportsbook/ui.tsx`
- Create: `src/components/sportsbook/market-panel.tsx`
- Create: `src/components/sportsbook/event-rows.tsx`
- Create: `src/components/sportsbook/sections.tsx`
- Modify: `src/components/live-sportsbook.tsx` (final size ≈ 300 lines)

All line numbers below refer to the ORIGINAL pre-task-5 file — re-locate symbols by name.

- [x] **Step 1: Create `sportsbook/ui.tsx`**

`"use client"`. Move verbatim: `TEAM_COLORS` (1096–1109), `hashString` (1111–1115), `TeamAvatar` (1117–1156), `PriceButton` (1160–1202), `SpreadCell` (1204–1236), `TotalCell` (1238–1270), `DrawButton` (1272–1300). Export the five components; keep `TEAM_COLORS`/`hashString` private. Imports: `Image` from `next/image`, `formatPrice` from `@/lib/formatters`, `cn` from `@/lib/utils`, types from `./types`.

- [x] **Step 2: Create `sportsbook/market-panel.tsx`**

`"use client"`. Move verbatim: the two `dynamic()` wrappers `OrderBook` (30–39) and `MarketPriceChart` (41–50) — **keep them as `next/dynamic` with the same options so the code-split boundary is preserved** — plus `MarketPositionsTable` (1302–1367), `MarketHistoryTable` (1369–1406), `MoneylineChartToken` type (1410–1414), `ExpandedMarketPanel` (1416–1625). Export `ExpandedMarketPanel` (and the `MoneylineChartToken` type if rows reference it). Imports: from `./format` (`toDecimal`, `formatUsd`, `formatSignedUsd`, `formatPositionPercent`), `formatCents`/`relativeTime` from `@/lib/formatters`, `useUserTrades`/`Trade` from `@/hooks/use-user-trades`, `resolveOutcomeTokenIds` from `./market-parsing`, types from `./types`.

- [x] **Step 3: Create `sportsbook/event-rows.tsx`**

`"use client"`. Move verbatim: `SportRowVariant` type (1629), `SportEventRow` (1631–2143), `CompactEventRow` (2146–2462). Export all three. This is the biggest move (~830 lines) — these components reference nearly every part-1 module: parsing (`findMoneyline`, `findSpread`, `findTotal`, `buildMoneylineDisplayData`, `parseTeamsFromTitle`, `teamAbbr`, `getSeriesInfo`, `getTournamentInfo`), dates (`getGameStartTime`, `formatStartTime`, `formatRelativeTime`), `useMarketPositionLookup`, `ExpandedMarketPanel` from `./market-panel`, the button components from `./ui`, `parseSportsScore`/`isTennisSetScore` from `@/lib/sports-score-format`, `tokenIdForOutcome` from `./format`. Copy imports precisely; typecheck will catch misses.

- [x] **Step 4: Create `sportsbook/sections.tsx`**

`"use client"`. Move verbatim: `LeagueSection` (2464–2583), `ScheduledLeagueSection` (2669–2797). Export both. Imports: rows from `./event-rows`, `leagueDisplayName` from `./league-region`, dates from `./dates`, types from `./types`.

- [x] **Step 5: Final `live-sportsbook.tsx`**

Keeps only: `"use client"`, the props types `LiveSportsbookProps`/`ScheduledSportsbookProps` (135–143), `LiveSportsbook` (2801–2916), `ScheduledSportsbook` (2918–3020), and the re-export block from Task 5 Step 8. Imports: `sections`, `league-region`, `market-parsing` (`buildSelectedMarket`), `format` (`resolveLivePrice`), `use-market-position-lookup`, store/websocket hooks (`useOrderBookStore`, `useOrderBookWebSocket`), `Skeleton`, types. Expected ≈ 300 lines.

- [x] **Step 6: Run gates + build**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm biome check src && pnpm next build`
Expected: green; `/events/sports/live` first-load within a few kB of pre-task (the `OrderBook`/`MarketPriceChart` dynamic chunks must still exist as separate chunks — if first-load jumped by >30 kB you inlined a dynamic import; re-check Step 2).

- [x] **Step 7: Live verification (chrome-devtools)**

On the sports live page (`/events/sports/live`, dev 8000 or prod 8001): live and scheduled sections render with league grouping; clicking a price button opens the trading flow with the right team/outcome; expanding a row shows the tabbed panel (position/history/order book/graph — order book and graph load lazily); **the positions tab shows P&L with NO `+` on gains and `-` kept on losses**; zero console errors.

- [x] **Step 8: STOP — do not commit.**

---

### Task 7: Plan-3 leftovers (small consolidation follow-ups)

**Files:**
- Modify: `src/hooks/use-search.ts` (~line 91)
- Modify: the 3 files still using `PROXY_WALLET_QUERY_KEY` (find them: `grep -rn "PROXY_WALLET_QUERY_KEY" src --include="*.ts" --include="*.tsx"`)
- Modify: `src/lib/query-keys.ts` (the `positions` factory)

- [x] **Step 1: Migrate `use-search.ts` to `fetchJson`**

At ~line 91 there is a raw `fetch` + manual `res.ok`/json handling. Replace with `fetchJson<T>` from `@/lib/fetch-json` (same pattern as the 18 hooks migrated in plan 3 — see `src/hooks/use-user-positions.ts` for the canonical example). Preserve the exact response typing and any custom empty-result handling (note: empty search results can be transient upstream rate-limiting; do NOT add retries here).

- [x] **Step 2: Migrate the `PROXY_WALLET_QUERY_KEY` leftovers to `qk`**

`grep -rn "PROXY_WALLET_QUERY_KEY" src`. For each site, swap to the `qk` factory equivalent already defined in `src/lib/query-keys.ts` — the factory MUST produce the byte-identical key array the constant produced (open both and compare; the plan-3 rule "exact string-spelling preservation" applies). If all usages are migrated, delete the constant; if the constant lives in `query-keys.ts` itself as the factory's source of truth, keep it private there.

- [x] **Step 3: Fix the unreachable `qk.positions.forMarket` root**

In `src/lib/query-keys.ts`, `qk.positions.forMarket(...)` currently roots at `"marketPositions"`, which `qk.positions.all()` invalidation can never reach. Change `forMarket` to root at the same `"positions"` root as the rest of the `positions` factory (e.g. `["positions", "market", conditionId, ...]` — match the factory's existing arg style). This deliberately changes a cache key spelling: the only effect is one cold refetch per user after deploy (client-side cache only, nothing persisted). Then `grep -rn "marketPositions" src` — expect zero remaining references; update `src/lib/query-keys.test.ts` to pin the new spelling and assert `forMarket(...)[0] === qk.positions.all()[0]`.

- [x] **Step 4: Run gates**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm biome check src`
Expected: green.

- [x] **Step 5: STOP — do not commit.**

---

### Task 8: Final cross-task verification

**Files:** none (verification only).

- [x] **Step 1: Full gate run**

```bash
pnpm tsc --noEmit
pnpm vitest run
pnpm biome check src
rm -rf .next && pnpm next build
```
Expected: all green; record the route table.

- [x] **Step 2: Bundle comparison**

Compare first-load JS against the plan-3 baseline: `/markets` 539 kB, `/events/detail/[slug]` 602 kB, `/portfolio` 564 kB, `/` 237 kB, `/events/sports/live` 556 kB. Splits are pure reshuffles — every route must be within ±10 kB of baseline. A bigger jump means a broken dynamic-import boundary; find it before proceeding.

- [x] **Step 3: SSR sweep (the Task-1 regression check)**

`pnpm next start -p 8001`, then the multi-route curl loop from Task 1 Step 7. Every route serves thousands of pre-flight body bytes; server log free of error digests. Kill the server after.

- [x] **Step 4: Live functional pass (chrome-devtools, port 8001)**

1. Landing: sections render, theme toggle + hard reload → no flash, view-source-equivalent check via `fetch` of `/` contains `<h1`.
2. `/markets`: cards render, adaptive cents intact (whole `17¢`, sub-cent `16.1¢`).
3. Event detail: chart range switching, order-book expansion, trading panel outcome selection.
4. `/events/sports/live`: full Task 6 Step 7 checklist.
5. `/agent`: dashboard renders panels (watchlist, runs, metrics; live-orders/positions/calibration panels appear with data or empty states).
6. `/portfolio`: positions table, no `+` on positive P&L anywhere.
7. Console: zero errors across all pages (warnings: only known baseline).

- [x] **Step 5: Report**

Summarize: gates, bundle deltas, SSR byte counts per route, functional results, and any deviations — then STOP. **No commits** (owner commits manually).

---

## Deliberately out of scope (owner decisions / risk calls)

- Shared rate-limit store (WAF/KV/DO), CSP nonce, challenge-token replay — deferred by owner.
- `createOrder`/approval state machine extraction from `use-clob-client.ts` — trading-critical, stays put.
- Component-body state extraction in `event-detail-client.tsx` beyond the chart hook — densely coupled, low payoff.
- `use-notifications`, `use-withdraw`, `use-open-orders`, `getTokenPrice` fetchJson migrations — intentionally skipped in plan 3 (custom error semantics); unchanged here.
- Duplicate `jsonError` in `lib/agent/api.ts` — different 3rd-arg semantics; agent surface is pre-release; leave as is.
- SSR-related follow-on: re-audit `loading.tsx`/Suspense fallbacks now that streaming actually streams — separate effort.

## Self-review notes

- Spec coverage: SSR fix → Task 1; use-clob-client → Task 2; agent-dashboard → Task 3; event-detail → Task 4; live-sportsbook → Tasks 5–6; formatSignedUsd no-plus rule → Task 5 Step 4 + Task 6 Step 7 + Task 8 Step 4; plan-3 leftovers → Task 7; final gates → Task 8.
- Type consistency: `./sportsbook/*` module names match between Tasks 5 and 6; `useChartRangeHistory` named once (Task 4); `readUsdcBalance` et al. only referenced within Task 2.
- Known risks called out inline: SSR crash surface on newly-rendered routes (Task 1 Step 7), behavior-pinning tests for moved functions (Task 2 Step 2, Task 5 Step 5), dynamic-import boundary preservation (Task 6 Steps 2/6, Task 8 Step 2), cache-key spelling change justification (Task 7 Step 3).
- Line numbers are anchors, not gospel — every move instruction names the symbols; re-locate by name if lines drifted.
