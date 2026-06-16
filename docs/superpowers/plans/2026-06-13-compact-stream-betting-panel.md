# Compact Stream Betting Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the streaming-surface betting widget into a denser, more compact layout (inline −/＋ stepper, BUY/SELL toggle, holdings footer, compact collapsed pill) matching the reference mock.

**Architecture:** Extract the new logic (stake stepping, holding selection, sell readiness, label/price formatting) into a pure, unit-testable module (`src/content/trading/stream-bet-logic.ts`), then wire it into the existing DOM builder `buildStreamBetting` in `src/content/ui.ts` and restyle the `.knoww-stream-*` CSS block in `src/content/knoww-inline.css`. The contextual-action state machine, one-click trade flow, and inline deposit are preserved.

**Tech Stack:** TypeScript, vanilla DOM (no framework), vanilla CSS (`.knoww-*` namespace, `!important` for host isolation), Vitest (node environment — no jsdom), Decimal.js for share math.

**Spec:** `docs/superpowers/specs/2026-06-13-compact-stream-betting-panel-design.md`

**Testing approach (important):** The Vitest env is `node` (see `vitest.config.ts`), so DOM builders can't be executed in tests. Follow the repo's two established patterns: **pure-logic unit tests** (real `assert`) for the new `stream-bet-logic.ts`, and **source/CSS-text assertion tests** (read the file, regex/substring checks) for the DOM/CSS structure — mirroring `tests/content/notification-panel-css.test.ts`.

**v1 scope note:** The holdings footer and SELL apply to **2-outcome** markets only (the `getOutcomeBalances` API is yes/no). Multi-outcome (3–4 option) cards keep BUY + stepper but show no footer/SELL. This is consistent with the spec's `getOutcomeBalances`-fed footer.

---

## File Structure

- **Create** `src/content/trading/stream-bet-logic.ts` — pure helpers: stake stepping/clamping, holding selection, sell readiness, label + pill-price formatting. No DOM, no globals.
- **Create** `tests/content/stream-bet-logic.test.ts` — unit tests for the above.
- **Create** `tests/content/stream-bet-structure.test.ts` — source/CSS-text assertions for the DOM + CSS structure.
- **Modify** `src/content/ui.ts` — `buildStreamBetting` (new head/toggle row, stepper, action row, holdings footer, SELL path, lazy balance load) and the notification-item `isStream` branch (compact collapsed pill).
- **Modify** `src/content/knoww-inline.css` — `.knoww-stream-*` block: new toggle/stepper/footer/pill selectors, tightened density, remove `.knoww-stream-chips*`.

---

## Task 1: Stake stepper logic (pure)

**Files:**
- Create: `apps/extension/src/content/trading/stream-bet-logic.ts`
- Test: `apps/extension/tests/content/stream-bet-logic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/extension/tests/content/stream-bet-logic.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  STREAM_STAKE_STEP,
  clampStake,
  stepStake,
} from "../../src/content/trading/stream-bet-logic";

test("STREAM_STAKE_STEP is $1", () => {
  assert.equal(STREAM_STAKE_STEP, 1);
});

test("clampStake floors at the minimum", () => {
  assert.equal(clampStake(0), 1);
  assert.equal(clampStake(-5), 1);
});

test("clampStake rounds to whole dollars", () => {
  assert.equal(clampStake(3.4), 3);
  assert.equal(clampStake(3.6), 4);
});

test("clampStake caps at the floored balance ceiling when funded", () => {
  assert.equal(clampStake(10, 1, 3.5), 3); // floor(3.5) = 3
  assert.equal(clampStake(10, 1, 0), 10); // max 0 => no ceiling
});

test("clampStake never returns below min even when balance < min", () => {
  assert.equal(clampStake(10, 1, 0.4), 1);
});

test("stepStake moves by one dollar and clamps", () => {
  assert.equal(stepStake(5, 1), 6);
  assert.equal(stepStake(5, -1), 4);
  assert.equal(stepStake(1, -1), 1); // already at floor
  assert.equal(stepStake(3, 1, 1, 3), 3); // at ceiling
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run tests/content/stream-bet-logic.test.ts`
Expected: FAIL — cannot resolve `../../src/content/trading/stream-bet-logic`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/extension/src/content/trading/stream-bet-logic.ts`:

```ts
// ============================================
// STREAM BET LOGIC — pure helpers for the compact stream betting widget
// ============================================
// No DOM, no globals: stake stepping, holding selection, sell readiness, and
// label/price formatting. Unit-testable in the node test env. The DOM builder
// (buildStreamBetting in ui.ts) imports these and renders around them.
// ============================================

/** Dollar increment for the stream stake stepper. */
export const STREAM_STAKE_STEP = 1;

/** Floor for a stream stake (USD). Min order size (in shares) is enforced at
 *  placement; the stepper just keeps the amount at or above $1. */
export const STREAM_STAKE_MIN = 1;

/**
 * Clamp a USD stake to whole dollars within [min, ceiling]. `max` of 0 means
 * "no ceiling" (balance unknown / not funded). When funded, the ceiling is the
 * floored balance, but never below `min`.
 */
export function clampStake(
  stake: number,
  min = STREAM_STAKE_MIN,
  max = 0
): number {
  let next = Number.isFinite(stake) ? Math.round(stake) : min;
  if (max > 0) {
    const ceiling = Math.max(min, Math.floor(max));
    if (next > ceiling) next = ceiling;
  }
  if (next < min) next = min;
  return next;
}

/** Step a stake up (+1) or down (-1) by STREAM_STAKE_STEP, then clamp. */
export function stepStake(
  current: number,
  dir: 1 | -1,
  min = STREAM_STAKE_MIN,
  max = 0
): number {
  return clampStake(current + dir * STREAM_STAKE_STEP, min, max);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run tests/content/stream-bet-logic.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/content/trading/stream-bet-logic.ts apps/extension/tests/content/stream-bet-logic.test.ts
git commit -m "feat(stream): add pure stake-stepper logic for compact betting panel"
```

---

## Task 2: Holding selection, sell readiness, labels, pill prices (pure)

**Files:**
- Modify: `apps/extension/src/content/trading/stream-bet-logic.ts`
- Test: `apps/extension/tests/content/stream-bet-logic.test.ts:append`

- [ ] **Step 1: Write the failing tests (append)**

Append to `apps/extension/tests/content/stream-bet-logic.test.ts`:

```ts
import {
  type StreamHolding,
  canSellHolding,
  formatHoldingLine,
  formatPillPrices,
  pickHolding,
  sellButtonLabel,
} from "../../src/content/trading/stream-bet-logic";

test("pickHolding returns null when nothing is held", () => {
  assert.equal(
    pickHolding([
      { outcomeIndex: 0, name: "FURIA", balance: "0", price: 0.6 },
      { outcomeIndex: 1, name: "MOUZ", balance: "0.001", price: 0.41 },
    ]),
    null
  );
});

test("pickHolding returns the held side with shares + value", () => {
  const h = pickHolding([
    { outcomeIndex: 0, name: "FURIA", balance: "5", price: 0.6 },
    { outcomeIndex: 1, name: "MOUZ", balance: "0", price: 0.41 },
  ]);
  assert.ok(h);
  assert.equal(h?.outcomeIndex, 0);
  assert.equal(h?.name, "FURIA");
  assert.equal(h?.shares, 5);
  assert.equal(h?.sharesLabel, "5");
  assert.equal(h?.valueUsd, "3.00");
});

test("pickHolding picks the larger-value side when both are held", () => {
  const h = pickHolding([
    { outcomeIndex: 0, name: "FURIA", balance: "2", price: 0.6 }, // $1.20
    { outcomeIndex: 1, name: "MOUZ", balance: "10", price: 0.41 }, // $4.10
  ]);
  assert.equal(h?.name, "MOUZ");
});

test("pickHolding formats fractional shares to one decimal", () => {
  const h = pickHolding([
    { outcomeIndex: 0, name: "FURIA", balance: "3.333333", price: 0.6 },
    { outcomeIndex: 1, name: "MOUZ", balance: "0", price: 0.41 },
  ]);
  assert.equal(h?.sharesLabel, "3.3");
});

test("formatHoldingLine renders 'shares name · $value'", () => {
  const h: StreamHolding = {
    outcomeIndex: 0,
    name: "FURIA",
    shares: 5,
    sharesLabel: "5",
    valueUsd: "3.00",
  };
  assert.equal(formatHoldingLine(h), "5 FURIA · $3.00");
});

test("sellButtonLabel renders 'Sell shares name · ~$value'", () => {
  const h: StreamHolding = {
    outcomeIndex: 0,
    name: "FURIA",
    shares: 5,
    sharesLabel: "5",
    valueUsd: "3.00",
  };
  assert.equal(sellButtonLabel(h), "Sell 5 FURIA · ~$3.00");
});

test("canSellHolding requires shares at or above the min order size", () => {
  const h: StreamHolding = {
    outcomeIndex: 0,
    name: "FURIA",
    shares: 5,
    sharesLabel: "5",
    valueUsd: "3.00",
  };
  assert.equal(canSellHolding(h, 5), true);
  assert.equal(canSellHolding(h, 6), false);
  assert.equal(canSellHolding(null, 5), false);
});

test("formatPillPrices renders 'A a¢ / B b¢' for two outcomes", () => {
  assert.equal(
    formatPillPrices([
      { name: "FURIA", price: 0.6 },
      { name: "MOUZ", price: 0.41 },
    ]),
    "FURIA 60¢ / MOUZ 41¢"
  );
});

test("formatPillPrices caps at the first two outcomes", () => {
  assert.equal(
    formatPillPrices(
      [
        { name: "A", price: 0.5 },
        { name: "B", price: 0.3 },
        { name: "C", price: 0.2 },
      ],
      2
    ),
    "A 50¢ / B 30¢"
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/extension && pnpm vitest run tests/content/stream-bet-logic.test.ts`
Expected: FAIL — `pickHolding`, `formatHoldingLine`, etc. not exported.

- [ ] **Step 3: Append the implementation**

Append to `apps/extension/src/content/trading/stream-bet-logic.ts`:

```ts
import {
  balanceToNumber,
  hasDisplayPosition,
  positionValueUsd,
} from "./outcome-balances";

/** A single surfaced holding for the compact footer / collapsed pill. */
export type StreamHolding = {
  outcomeIndex: number;
  name: string;
  shares: number;
  sharesLabel: string;
  valueUsd: string; // "X.XX"
};

/** One candidate side to consider for the surfaced holding. */
export type HoldingCandidate = {
  outcomeIndex: number;
  name: string;
  balance: string; // decimal share string from getOutcomeBalances
  price: number; // current outcome price (0..1)
};

function formatShares(shares: number): string {
  return Number.isInteger(shares) ? String(shares) : shares.toFixed(1);
}

/**
 * Pick the single holding to surface: the larger-value side when both are held,
 * otherwise whichever side is a display position. Returns null when neither side
 * clears the display threshold.
 */
export function pickHolding(
  candidates: HoldingCandidate[]
): StreamHolding | null {
  let best: StreamHolding | null = null;
  let bestValue = -1;
  for (const c of candidates) {
    if (!hasDisplayPosition(c.balance)) continue;
    const valueUsd = positionValueUsd(c.balance, c.price);
    const value = Number(valueUsd);
    if (value > bestValue) {
      bestValue = value;
      const shares = balanceToNumber(c.balance);
      best = {
        outcomeIndex: c.outcomeIndex,
        name: c.name,
        shares,
        sharesLabel: formatShares(shares),
        valueUsd,
      };
    }
  }
  return best;
}

/** Footer holding line, e.g. "5 FURIA · $3.00" (the "YOU HOLD" label is DOM). */
export function formatHoldingLine(h: StreamHolding): string {
  return `${h.sharesLabel} ${h.name} · $${h.valueUsd}`;
}

/** SELL action label, e.g. "Sell 5 FURIA · ~$3.00". */
export function sellButtonLabel(h: StreamHolding): string {
  return `Sell ${h.sharesLabel} ${h.name} · ~$${h.valueUsd}`;
}

/** Whether the held position is large enough to place a market sell. */
export function canSellHolding(
  h: StreamHolding | null,
  minOrderSize: number
): boolean {
  if (!h) return false;
  return h.shares >= Math.max(minOrderSize, 0);
}

/** Compact collapsed-pill price line, e.g. "FURIA 60¢ / MOUZ 41¢". */
export function formatPillPrices(
  outcomes: { name: string; price: number }[],
  max = 2
): string {
  return outcomes
    .slice(0, max)
    .map((o) => `${o.name} ${Math.round(o.price * 100)}¢`)
    .join(" / ");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/extension && pnpm vitest run tests/content/stream-bet-logic.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Typecheck**

Run: `cd apps/extension && pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/content/trading/stream-bet-logic.ts apps/extension/tests/content/stream-bet-logic.test.ts
git commit -m "feat(stream): add holding-selection + label formatting logic"
```

---

## Task 3: Compact CSS — toggle, stepper, footer, pill, density

**Files:**
- Modify: `apps/extension/src/content/knoww-inline.css` (the `.knoww-stream-*` block, ~2210–2562)
- Test: `apps/extension/tests/content/stream-bet-structure.test.ts`

- [ ] **Step 1: Write the failing CSS-structure test**

Create `apps/extension/tests/content/stream-bet-structure.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

declare const process: { cwd(): string };

function readCss(): string {
  return readFileSync(join(process.cwd(), "src/content/knoww-inline.css"), "utf8");
}

test("compact stream CSS defines the new toggle/stepper/footer/pill selectors", () => {
  const css = readCss();
  for (const sel of [
    ".knoww-stream-head",
    ".knoww-stream-title",
    ".knoww-stream-buysell",
    ".knoww-stream-bs-opt",
    ".knoww-stream-actionrow",
    ".knoww-stream-stepper",
    ".knoww-stream-step-btn",
    ".knoww-stream-step-val",
    ".knoww-stream-hold",
    ".knoww-stream-hold-sell",
    ".knoww-stream-pill",
    ".knoww-stream-pill-hold",
  ]) {
    assert.ok(css.includes(sel), `expected CSS to define ${sel}`);
  }
});

test("the old preset-chips CSS is removed", () => {
  const css = readCss();
  assert.ok(!css.includes(".knoww-stream-chip"), "expected .knoww-stream-chip* to be gone");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run tests/content/stream-bet-structure.test.ts`
Expected: FAIL — new selectors missing (and `.knoww-stream-chip` still present).

- [ ] **Step 3: Remove the old chips CSS**

In `apps/extension/src/content/knoww-inline.css`, delete the `Amount chips — simple pills.` block — the rules for `.knoww-stream-chips`, `.knoww-stream-chip`, `.knoww-stream-chip:hover`, `.knoww-stream-chip.active` (currently ~lines 2385–2415). Also remove `.knoww-stream-chips` from the `.depositing` hide rule (currently ~line 2239) so it reads:

```css
#knoww-notification-stack .knoww-stream-bet.depositing .knoww-stream-seg-row,
#knoww-notification-stack .knoww-stream-bet.depositing .knoww-stream-actionrow {
  display: none !important;
}
```

- [ ] **Step 4: Tighten segment + trade density**

In `.knoww-stream-seg` change padding/border-radius/font:

```css
.knoww-stream-seg {
  flex: 1 1 calc(50% - 4px) !important;
  box-sizing: border-box !important;
  min-width: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 6px !important;
  padding: 8px 10px !important;
  border: 1.5px solid var(--knoww-border, rgb(47, 51, 54)) !important;
  border-radius: 9px !important;
  background: transparent !important;
  color: var(--knoww-text, rgb(231, 233, 234)) !important;
  font-family: inherit !important;
  font-size: 12px !important;
  cursor: pointer !important;
  transition:
    border-color 0.12s ease,
    background 0.12s ease !important;
}
```

In `.knoww-stream-trade` change padding/font:

```css
.knoww-stream-trade {
  width: 100% !important;
  border: none !important;
  border-radius: 10px !important;
  padding: 9px 11px !important;
  font-family: inherit !important;
  font-weight: 600 !important;
  font-size: 13px !important;
  cursor: pointer !important;
  color: #fff !important;
  background: var(--knoww-accent-green, rgb(0, 186, 124)) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 6px !important;
  transition:
    filter 0.12s ease,
    opacity 0.12s ease !important;
}
```

Also reduce the wrap gap — change `.knoww-stream-bet { gap: 8px }` to `gap: 6px`.

- [ ] **Step 5: Add the new component CSS**

Append, immediately after the `.knoww-stream-trade-sub` rule, the new selectors:

```css
/* ─── Compact head: short title + BUY/SELL toggle ─── */
.knoww-stream-head {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 8px !important;
}
.knoww-stream-title {
  font-size: 12px !important;
  font-weight: 600 !important;
  color: var(--knoww-text, rgb(231, 233, 234)) !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  min-width: 0 !important;
}
.knoww-stream-buysell {
  display: inline-flex !important;
  flex: none !important;
  padding: 2px !important;
  gap: 2px !important;
  border-radius: 8px !important;
  background: var(--knoww-header-chip-bg, rgba(255, 255, 255, 0.06)) !important;
}
.knoww-stream-bs-opt {
  border: none !important;
  background: transparent !important;
  color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
  font-family: inherit !important;
  font-size: 10px !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em !important;
  text-transform: uppercase !important;
  padding: 4px 9px !important;
  border-radius: 6px !important;
  cursor: pointer !important;
  transition:
    background 0.12s ease,
    color 0.12s ease !important;
}
.knoww-stream-bs-opt.sel {
  background: var(--knoww-bg, rgb(0, 0, 0)) !important;
  color: var(--knoww-text, rgb(231, 233, 234)) !important;
}

/* ─── Action row: inline −/＋ stepper + trade button on one line ─── */
.knoww-stream-actionrow {
  display: grid !important;
  grid-template-columns: auto 1fr !important;
  gap: 6px !important;
  align-items: stretch !important;
}
/* Setup/long-label states drop the stepper; the button spans the row. */
.knoww-stream-actionrow.full {
  grid-template-columns: 1fr !important;
}
.knoww-stream-stepper {
  display: inline-flex !important;
  align-items: center !important;
  gap: 2px !important;
  border: 1px solid var(--knoww-border, rgb(47, 51, 54)) !important;
  border-radius: 10px !important;
  padding: 2px !important;
}
.knoww-stream-step-btn {
  width: 26px !important;
  height: 26px !important;
  display: grid !important;
  place-items: center !important;
  border: none !important;
  background: transparent !important;
  color: var(--knoww-text, rgb(231, 233, 234)) !important;
  font-size: 16px !important;
  line-height: 1 !important;
  border-radius: 8px !important;
  cursor: pointer !important;
  transition: background 0.12s ease !important;
}
.knoww-stream-step-btn:hover {
  background: var(--knoww-header-chip-bg, rgba(255, 255, 255, 0.06)) !important;
}
.knoww-stream-step-btn:disabled {
  opacity: 0.4 !important;
  cursor: default !important;
}
.knoww-stream-step-val {
  min-width: 34px !important;
  text-align: center !important;
  font-family: inherit !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  color: var(--knoww-text, rgb(231, 233, 234)) !important;
}

/* ─── Holdings footer: "YOU HOLD … · $value" + one-tap SELL ─── */
.knoww-stream-hold {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  padding-top: 6px !important;
  margin-top: 2px !important;
  border-top: 1px solid var(--kse-hairline, rgba(255, 255, 255, 0.08)) !important;
  font-family: "KnowwMono", "SF Mono", "Consolas", monospace !important;
  font-size: 10px !important;
  letter-spacing: 0.04em !important;
  color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
}
.knoww-stream-hold-text {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}
.knoww-stream-hold-label {
  color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
}
.knoww-stream-hold-val {
  color: var(--knoww-text, rgb(231, 233, 234)) !important;
  font-weight: 600 !important;
}
.knoww-stream-hold-sell {
  flex: none !important;
  border: 1px solid var(--knoww-border, rgb(47, 51, 54)) !important;
  background: transparent !important;
  color: rgb(229, 115, 115) !important;
  font-family: inherit !important;
  font-size: 9px !important;
  font-weight: 700 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  padding: 4px 10px !important;
  border-radius: 999px !important;
  cursor: pointer !important;
  transition:
    background 0.12s ease,
    border-color 0.12s ease !important;
}
.knoww-stream-hold-sell:hover {
  background: rgba(221, 33, 96, 0.12) !important;
  border-color: rgb(221, 33, 96) !important;
}
.knoww-stream-hold-sell:disabled {
  opacity: 0.4 !important;
  cursor: default !important;
}

/* ─── Compact collapsed pill (stream rows only) ─── */
.knoww-notification-item--stream .knoww-stream-pill {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  width: 100% !important;
  min-width: 0 !important;
  font-family: "KnowwMono", "SF Mono", "Consolas", monospace !important;
  font-size: 12px !important;
  font-weight: 600 !important;
}
.knoww-stream-pill-prices {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  color: var(--knoww-text, rgb(231, 233, 234)) !important;
}
.knoww-stream-pill-hold {
  flex: none !important;
  font-size: 9px !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em !important;
  text-transform: uppercase !important;
  color: var(--knoww-accent-green, rgb(0, 186, 124)) !important;
  border: 1px solid var(--kse-hairline-2, rgba(255, 255, 255, 0.14)) !important;
  border-radius: 999px !important;
  padding: 2px 7px !important;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run tests/content/stream-bet-structure.test.ts`
Expected: PASS (the holding-selectors test and the chips-removed test).

- [ ] **Step 7: Lint + commit**

```bash
cd apps/extension && pnpm lint
git add apps/extension/src/content/knoww-inline.css apps/extension/tests/content/stream-bet-structure.test.ts
git commit -m "feat(stream): compact CSS for toggle, stepper, holdings footer, pill"
```

Expected lint: passes (pre-existing `noDescendingSpecificity` warnings in unrelated files are fine; do not introduce new errors).

---

## Task 4: Wire compact widget into `buildStreamBetting`

**Files:**
- Modify: `apps/extension/src/content/ui.ts` (`buildStreamBetting`, ~3122–3459)
- Test: `apps/extension/tests/content/stream-bet-structure.test.ts:append`

This rewrites the widget's structure and behavior. The existing internal helpers `streamOptionsFor`, `getStreamStake`, `runSetup`, `pollBalanceChange`, `openInlineDeposit`, `doPlace`, `resolveOrderTokens`, and `submitStreamMarketOrder` are reused unchanged unless noted.

- [ ] **Step 1: Write the failing source-structure test (append)**

Append to `apps/extension/tests/content/stream-bet-structure.test.ts`:

```ts
function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function streamBetSource(): string {
  const src = readSource("src/content/ui.ts");
  const start = src.indexOf("function buildStreamBetting");
  assert.ok(start !== -1, "expected buildStreamBetting to exist");
  const next = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

test("buildStreamBetting imports the pure stream-bet logic", () => {
  const src = readSource("src/content/ui.ts");
  assert.ok(
    /from\s+"\.\/trading\/stream-bet-logic"/.test(src),
    "expected ui.ts to import stream-bet-logic"
  );
});

test("buildStreamBetting builds the compact head, stepper and footer", () => {
  const fn = streamBetSource();
  for (const cls of [
    "knoww-stream-head",
    "knoww-stream-buysell",
    "knoww-stream-actionrow",
    "knoww-stream-stepper",
    "knoww-stream-hold",
  ]) {
    assert.ok(fn.includes(cls), `expected buildStreamBetting to render ${cls}`);
  }
});

test("buildStreamBetting wires a SELL path", () => {
  const fn = streamBetSource();
  assert.ok(/side:\s*"SELL"/.test(fn), "expected a SELL order branch");
});

test("the old chips renderer is gone", () => {
  const fn = streamBetSource();
  assert.ok(!fn.includes("knoww-stream-chip"), "expected chip rendering removed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run tests/content/stream-bet-structure.test.ts`
Expected: FAIL — import + new classes + SELL not present yet.

- [ ] **Step 3: Add the import**

At the top of `apps/extension/src/content/ui.ts`, near the existing `STREAM_TRADE_AMOUNT_PRESETS` import, add:

```ts
import {
  type StreamHolding,
  canSellHolding,
  clampStake,
  formatHoldingLine,
  pickHolding,
  sellButtonLabel,
  stepStake,
} from "./trading/stream-bet-logic";
```

- [ ] **Step 4: Add a market-sell helper**

Immediately after `submitStreamMarketOrder` (ends ~line 3111), add:

```ts
/** Place a market SELL of `shares` of the given stream outcome. Throws on failure. */
async function submitStreamMarketSell(
  market: Market,
  opt: StreamOption,
  shares: number
): Promise<void> {
  const tokens = await resolveOrderTokens(
    market,
    opt.outcomeIndex,
    opt.isMulti,
    opt.marketIndex
  );
  if (!tokens.tokenId) throw new Error("Could not resolve market token");
  await TradingService.placeOrder({
    tokenId: tokens.tokenId,
    conditionId: tokens.conditionId,
    outcomeIndex: opt.outcomeIndex,
    side: "SELL",
    price: 0,
    size: shares,
    amount: 0,
    orderType: "FAK",
    negRisk: tokens.negRisk,
    isMarketableBuy: false,
  });
}
```

- [ ] **Step 5: Replace the widget assembly block**

Replace the assembly + state declarations at the top of `buildStreamBetting` (from `const wrap = document.createElement("div");` through the `let busy: string | null = null;` line, ~3127–3155) with:

```ts
  const wrap = document.createElement("div");
  wrap.className = "knoww-stream-bet";

  // Head: short title + BUY/SELL toggle.
  const head = document.createElement("div");
  head.className = "knoww-stream-head";
  const titleEl = document.createElement("span");
  titleEl.className = "knoww-stream-title";
  titleEl.textContent = streamShortTitle(market);
  const buysell = document.createElement("div");
  buysell.className = "knoww-stream-buysell";
  head.appendChild(titleEl);
  head.appendChild(buysell);

  const segRow = document.createElement("div");
  segRow.className = "knoww-stream-seg-row";

  // Action row: inline stepper + contextual trade button on one line.
  const actionRow = document.createElement("div");
  actionRow.className = "knoww-stream-actionrow";
  const stepperWrap = document.createElement("div");
  stepperWrap.className = "knoww-stream-stepper";
  const actionWrap = document.createElement("div");
  actionWrap.className = "knoww-stream-action";
  actionRow.appendChild(stepperWrap);
  actionRow.appendChild(actionWrap);

  // Holdings footer (2-outcome markets only; filled once balances load).
  const holdFooter = document.createElement("div");
  holdFooter.className = "knoww-stream-hold";
  holdFooter.style.display = "none";

  // Host for the inline deposit flow (unchanged behavior).
  const depositHost = document.createElement("div");
  depositHost.className = "knoww-stream-deposit-host";

  wrap.appendChild(head);
  wrap.appendChild(segRow);
  wrap.appendChild(actionRow);
  wrap.appendChild(holdFooter);
  wrap.appendChild(depositHost);

  let selectedIdx = 0;
  let side: "BUY" | "SELL" = "BUY";
  let holding: StreamHolding | null = null;
  let txStatus: StreamTxStatus = "idle";
  let depositing = false;
  let lastError: string | null = null;
  let busy: string | null = null;
  const twoSided = options.length === 2;
```

- [ ] **Step 6: Add `streamShortTitle` helper**

Immediately before `function buildStreamBetting` add:

```ts
/** A short market label for the compact head, e.g. "FURIA vs MOUZ". Falls back
 *  to the market title, trimmed of any " - <event>" suffix. */
function streamShortTitle(market: Market): string {
  const title = market.title || "Market";
  return title.split(/\s[-–—|]\s/)[0].trim() || title;
}
```

- [ ] **Step 7: Replace `renderChips` with `renderStepper`**

Replace the whole `renderChips` function (~3301–3318) with:

```ts
  function stakeCeiling(): number {
    const bal = TradingService.getContext().balance;
    return bal > 0 ? bal : 0;
  }

  function renderStepper(): void {
    stepperWrap.innerHTML = "";
    const stake = getStreamStake();
    const max = stakeCeiling();
    const mk = (label: string, dir: 1 | -1): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "knoww-stream-step-btn";
      b.textContent = label;
      const nextVal = stepStake(stake, dir, 1, max);
      b.disabled = nextVal === stake;
      b.onclick = (e) => {
        e.stopPropagation();
        streamStakeUsd = stepStake(getStreamStake(), dir, 1, stakeCeiling());
        txStatus = "idle";
        renderStepper();
        renderAction();
      };
      return b;
    };
    const val = document.createElement("span");
    val.className = "knoww-stream-step-val";
    val.textContent = `$${clampStake(stake, 1, max)}`;
    stepperWrap.appendChild(mk("−", -1));
    stepperWrap.appendChild(val);
    stepperWrap.appendChild(mk("+", 1));
  }
```

- [ ] **Step 8: Add `renderHead` (BUY/SELL toggle) and `loadHolding` / `renderHold`**

Add these functions inside `buildStreamBetting` (e.g. after `renderStepper`):

```ts
  function renderHead(): void {
    buysell.innerHTML = "";
    // SELL only makes sense on 2-outcome markets where we can read holdings.
    buysell.style.display = twoSided ? "inline-flex" : "none";
    if (!twoSided) return;
    (["BUY", "SELL"] as const).forEach((s) => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = `knoww-stream-bs-opt${s === side ? " sel" : ""}`;
      opt.textContent = s;
      opt.onclick = (e) => {
        e.stopPropagation();
        if (side === s) return;
        side = s;
        // In SELL the position is sold whole; the stepper is meaningless.
        txStatus = "idle";
        renderHead();
        renderStepper();
        renderAction();
      };
      buysell.appendChild(opt);
    });
  }

  function renderHold(): void {
    if (!twoSided || !holding) {
      holdFooter.style.display = "none";
      holdFooter.innerHTML = "";
      return;
    }
    holdFooter.style.display = "flex";
    holdFooter.innerHTML = "";
    const text = document.createElement("span");
    text.className = "knoww-stream-hold-text";
    const label = document.createElement("span");
    label.className = "knoww-stream-hold-label";
    label.textContent = "YOU HOLD ";
    const val = document.createElement("span");
    val.className = "knoww-stream-hold-val";
    val.textContent = formatHoldingLine(holding);
    text.appendChild(label);
    text.appendChild(val);

    const sell = document.createElement("button");
    sell.type = "button";
    sell.className = "knoww-stream-hold-sell";
    sell.textContent = "Sell";
    const ctx = TradingService.getContext();
    sell.disabled = !canSellHolding(holding, ctx.minOrderSize || 0);
    sell.onclick = (e) => {
      e.stopPropagation();
      if (!holding) return;
      selectedIdx = holding.outcomeIndex;
      side = "SELL";
      renderHead();
      renderSegments();
      renderStepper();
      doSell();
    };
    holdFooter.appendChild(text);
    holdFooter.appendChild(sell);
  }

  // Lazily resolve both outcome tokens, read balances, and surface the holding.
  async function loadHolding(): Promise<void> {
    if (!twoSided) return;
    try {
      const [yesTok, noTok] = await Promise.all([
        resolveOrderTokens(market, options[0].outcomeIndex, options[0].isMulti, options[0].marketIndex),
        resolveOrderTokens(market, options[1].outcomeIndex, options[1].isMulti, options[1].marketIndex),
      ]);
      if (!yesTok.tokenId || !noTok.tokenId) return;
      const balances = await TradingService.getOutcomeBalances(yesTok.tokenId, noTok.tokenId);
      holding = pickHolding([
        { outcomeIndex: options[0].outcomeIndex, name: options[0].name, balance: balances.yesBalance, price: options[0].price },
        { outcomeIndex: options[1].outcomeIndex, name: options[1].name, balance: balances.noBalance, price: options[1].price },
      ]);
      renderHold();
      renderPill();
      // Switching to SELL is only valid with a holding; revert if it vanished.
      if (side === "SELL" && !holding) {
        side = "BUY";
        renderHead();
        renderStepper();
      }
      renderAction();
    } catch {
      /* balances are best-effort; leave the footer hidden */
    }
  }
```

> Note: `renderPill()` is defined in Task 5 (the collapsed-pill render). Until then it can be a no-op; Task 5 replaces it. To keep this task self-contained, add a temporary `function renderPill(): void {}` inside `buildStreamBetting` now; Task 5 fills it in.

- [ ] **Step 9: Add `doSell`**

Add inside `buildStreamBetting` (near `doPlace`):

```ts
  function doSell(): void {
    if (!holding) return;
    const opt = options[holding.outcomeIndex];
    const balanceBefore = TradingService.getContext().balance;
    txStatus = "placing";
    renderAction();
    submitStreamMarketSell(market, opt, holding.shares)
      .then(() => {
        txStatus = "placed";
        lastError = null;
        pollBalanceChange(balanceBefore);
        void loadHolding();
      })
      .catch((err: unknown) => {
        txStatus = "failed";
        lastError = err instanceof Error ? err.message : String(err) || null;
        void TradingService.refreshBalance();
      })
      .finally(() => {
        renderAction();
        window.setTimeout(() => {
          if (txStatus === "placed" || txStatus === "failed") {
            txStatus = "idle";
            renderAction();
          }
        }, 2800);
      });
  }
```

- [ ] **Step 10: Branch `renderAction` for SELL + toggle the stepper**

In `renderAction`, at the very top (after `actionWrap.innerHTML = "";`), add the SELL branch and stepper visibility control:

```ts
    // Toggle the action row to full-width when the stepper shouldn't show.
    const showStepper =
      side === "BUY" &&
      !busy &&
      (txStatus === "idle" || txStatus === "failed" || txStatus === "placed");

    // SELL mode: a single whole-position sell button (or a disabled hint).
    if (side === "SELL") {
      actionRow.classList.add("full");
      stepperWrap.style.display = "none";
      const ctx = TradingService.getContext();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "knoww-stream-trade rose";
      if (!holding || !canSellHolding(holding, ctx.minOrderSize || 0)) {
        btn.classList.remove("rose");
        btn.classList.add("ghost");
        btn.disabled = true;
        btn.textContent = holding ? "Position too small to sell" : "Nothing to sell";
      } else if (txStatus === "placing") {
        btn.classList.remove("rose");
        btn.classList.add("ghost");
        btn.disabled = true;
        btn.innerHTML = `<span class="knoww-stream-spin"></span> Selling…`;
      } else if (txStatus === "placed") {
        btn.classList.remove("rose");
        btn.classList.add("green");
        btn.disabled = true;
        btn.textContent = "Sold ✓";
      } else {
        btn.textContent = sellButtonLabel(holding);
        btn.onclick = (e) => {
          e.stopPropagation();
          doSell();
        };
      }
      actionWrap.appendChild(btn);
      return;
    }

    actionRow.classList.toggle("full", !showStepper);
    stepperWrap.style.display = showStepper ? "inline-flex" : "none";
```

The rest of `renderAction` (the existing BUY state machine) stays unchanged below this.

- [ ] **Step 11: Update the initial render + state subscription**

Replace the exact tail block of `buildStreamBetting` (currently lines ~3461–3481):

```ts
  renderSegments();
  renderChips();
  renderAction();

  // Each card reads wallet readiness from the shared TradingService at render
  // time, so without this every card would keep showing "Connect to trade"
  // even after another card connected. Re-render on global state changes; skip
  // while this card has an inline setup in flight (its own finally re-renders),
  // and self-unsubscribe once the card leaves the DOM.
  const unsubState = TradingService.onStateChange(() => {
    if (!wrap.isConnected) {
      unsubState();
      return;
    }
    // While the inline deposit owns the card, its own subscription drives
    // rendering — don't stomp it with the bet action.
    if (busy || depositing) return;
    renderAction();
  });

  return wrap;
```

with:

```ts
  renderHead();
  renderSegments();
  renderStepper();
  renderAction();
  renderHold();
  renderPill();
  void loadHolding();

  // Each card reads wallet readiness from the shared TradingService at render
  // time. Re-render the stepper/action/footer on global state changes; skip
  // while an inline setup/deposit is in flight, and self-unsubscribe once the
  // card leaves the DOM.
  const unsubState = TradingService.onStateChange(() => {
    if (!wrap.isConnected) {
      unsubState();
      return;
    }
    if (busy || depositing) return;
    renderStepper();
    renderAction();
    renderHold();
  });

  // Refresh holdings when this card is (re)expanded (see the item click handler).
  wrap.addEventListener("knoww-stream-expanded", () => void loadHolding());

  return wrap;
```

- [ ] **Step 12: Fire the expand event so holdings refresh on open**

In the notification-item `isStream` click handler (`ui.ts` ~3603), after `item.classList.toggle("expanded", willExpand);` add:

```ts
      if (willExpand) {
        item
          .querySelector(".knoww-stream-bet")
          ?.dispatchEvent(new CustomEvent("knoww-stream-expanded"));
      }
```

- [ ] **Step 13: Typecheck + run tests**

Run: `cd apps/extension && pnpm typecheck && pnpm vitest run tests/content/stream-bet-structure.test.ts tests/content/stream-bet-logic.test.ts`
Expected: typecheck clean; all tests PASS.

- [ ] **Step 14: Commit**

```bash
git add apps/extension/src/content/ui.ts apps/extension/tests/content/stream-bet-structure.test.ts
git commit -m "feat(stream): compact betting widget — toggle, stepper, holdings footer, sell"
```

---

## Task 5: Compact collapsed pill

**Files:**
- Modify: `apps/extension/src/content/ui.ts` (notification-item `isStream` branch ~3593–3600; `renderPill` in `buildStreamBetting`)
- Test: `apps/extension/tests/content/stream-bet-structure.test.ts:append`

- [ ] **Step 1: Write the failing test (append)**

Append to `apps/extension/tests/content/stream-bet-structure.test.ts`:

```ts
test("stream rows render the compact collapsed pill via formatPillPrices", () => {
  const src = readSource("src/content/ui.ts");
  assert.ok(src.includes("knoww-stream-pill"), "expected the pill container");
  assert.ok(
    /formatPillPrices\(/.test(src),
    "expected the pill to use formatPillPrices"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/extension && pnpm vitest run tests/content/stream-bet-structure.test.ts`
Expected: FAIL — pill container / `formatPillPrices` not referenced yet.

- [ ] **Step 3: Import `formatPillPrices`**

Add `formatPillPrices` to the existing `./trading/stream-bet-logic` import added in Task 4 Step 3.

- [ ] **Step 4: Build the pill in the `isStream` branch**

In the notification-item builder's `isStream` block (~3593), the current code appends `pricesDiv` then `buildStreamBetting`. Replace the collapsed content so stream rows use the compact pill. After `item.classList.add("knoww-notification-item--stream");`, build the pill instead of the default title/prices:

```ts
    // Compact collapsed pill: prices + (optional) holdings chip + chevron.
    content.innerHTML = "";
    const pill = document.createElement("div");
    pill.className = "knoww-stream-pill";
    const prices = document.createElement("span");
    prices.className = "knoww-stream-pill-prices";
    prices.textContent = formatPillPrices(
      outcomes.map((name, i) => ({ name, price: priceData[i] ?? 0 }))
    );
    const holdChip = document.createElement("span");
    holdChip.className = "knoww-stream-pill-hold";
    holdChip.style.display = "none";
    pill.appendChild(prices);
    pill.appendChild(holdChip);
    content.appendChild(pill);
```

Keep `item.appendChild(buildStreamBetting(market));` (drop the separate `item.appendChild(pricesDiv);` for stream rows — the pill replaces it). The `pricesDiv` build above the branch can stay for non-stream rows; only the stream branch skips appending it.

- [ ] **Step 5: Implement `renderPill` to update the holdings chip**

Replace the temporary `function renderPill(): void {}` in `buildStreamBetting` with one that updates the pill's holdings chip from the loaded `holding`. Since the pill lives on the parent item, locate it from `wrap`:

```ts
  function renderPill(): void {
    const item = wrap.closest(".knoww-notification-item--stream");
    const chip = item?.querySelector<HTMLElement>(".knoww-stream-pill-hold");
    if (!chip) return;
    if (holding) {
      chip.textContent = `${holding.sharesLabel} ${holding.name}`;
      chip.style.display = "";
    } else {
      chip.style.display = "none";
    }
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/extension && pnpm vitest run tests/content/stream-bet-structure.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
cd apps/extension && pnpm typecheck
git add apps/extension/src/content/ui.ts apps/extension/tests/content/stream-bet-structure.test.ts
git commit -m "feat(stream): compact collapsed pill with prices + holdings chip"
```

---

## Task 6: Integration verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `cd apps/extension && pnpm test`
Expected: PASS (scoring suite unaffected; new stream tests green).

- [ ] **Step 2: Typecheck + lint + build**

Run: `cd apps/extension && pnpm typecheck && pnpm lint && pnpm build`
Expected: typecheck clean; lint passes (no NEW errors); webpack build + `assert-production-bundle` succeed.

- [ ] **Step 3: Manual verification on Twitch (load unpacked `dist/`)**

Load the built extension and open a live Twitch stream with markets, then confirm each state:
- [ ] Collapsed stream rows show the compact pill (`A a¢ / B b¢` + chevron); a holdings chip appears only when you hold a side.
- [ ] Expanding shows: short title + BUY/SELL toggle, two tightened outcome segments, the −/＋ stepper inline beside the Trade button (one row), and — when holding — the `YOU HOLD … · $value` footer with a SELL button.
- [ ] Stepper increments/decrements `$1`, floors at `$1`, and the `+` disables at your balance ceiling when funded.
- [ ] Disconnected / enable / approve / insufficient(deposit) states hide the stepper and show the full-width contextual button (label fits).
- [ ] BUY places a one-click trade (existing behavior); after fill the footer + pill chip update.
- [ ] Toggle to SELL → button reads `Sell N <outcome> · ~$X`; tapping sells the whole position; footer/pill clear after settlement.
- [ ] SELL is disabled with "Nothing to sell" when you hold nothing, and "Position too small to sell" below min order size.
- [ ] The card is visibly shorter than the previous build at every state.
- [ ] Multi-outcome (3–4 option) cards still render (BUY + stepper), with no footer/SELL and no BUY/SELL toggle.

- [ ] **Step 4: Final commit (if any fixups)**

```bash
git add -A
git commit -m "fix(stream): polish from manual verification"
```

---

## Self-review notes

- **Spec coverage:** title+toggle (Task 4), tightened segments (Task 3), inline stepper replacing chips (Tasks 1,3,4), BUY/SELL whole-position sell (Tasks 2,4), holdings footer shares+value (Tasks 2,4), compact collapsed pill (Tasks 2,3,5), density tokens (Task 3), all-streaming-surface scope (CSS on `.knoww-notification-item--stream`, not Twitch-gated). Deferred per spec: avg-cost/P&L, partial-size sell, multi-outcome footer.
- **Type consistency:** `StreamHolding` (`outcomeIndex/name/shares/sharesLabel/valueUsd`), `HoldingCandidate`, `clampStake/stepStake(current,dir,min,max)`, `pickHolding(candidates)`, `formatHoldingLine/sellButtonLabel(h)`, `canSellHolding(h,min)`, `formatPillPrices(outcomes,max)` are used identically across tasks. `submitStreamMarketSell` mirrors `submitStreamMarketOrder`'s `placeOrder` shape.
- **Placeholders:** none — `renderPill` has an explicit temporary-then-replaced path (Task 4 Step 8 → Task 5 Step 5).
