# Compact stream betting panel — design

**Date:** 2026-06-13
**Surface:** Live-streaming platforms only (`.knoww-notification-item--stream`; Twitch today, YouTube/Kick when added)
**Scope:** Restructure the existing stream betting widget into a denser, more compact layout matching the Polymarket-style reference mock. No changes to the feed-injection path.

---

## 1. Problem & goal

The streaming surface already has a customized betting widget (`buildStreamBetting`
in `apps/extension/src/content/ui.ts`). When a stream market row is expanded it
renders a **vertical 3-row stack**:

1. outcome segments (`.knoww-stream-seg-row`)
2. preset amount chips (`.knoww-stream-chips`, `$1/$5/$20/…`)
3. one full-width contextual Trade button + hint (`.knoww-stream-action`)

The goal is to make this panel **smaller / denser**, matching the reference mock:
merge the amount selector into a compact `−/＋` stepper placed **inline beside**
the Trade button (two rows → one), add a BUY/SELL toggle, a holdings footer, and
a compact collapsed pill. Net result: a meaningfully shorter card that reads like
the reference.

This is a refinement of the existing stream widget — **not** a redesign of the
feed cards, notification stack shell, or the full trading panel.

---

## 2. Target layout

```
COLLAPSED (pill):
┌─────────────────────────────────────────────────────────┐
│ ● FURIA 60¢ / MOUZ 41¢            [ 5 FURIA ]   ⌄         │
└─────────────────────────────────────────────────────────┘

EXPANDED:
┌─────────────────────────────────────────────────────────┐
│ FURIA vs MOUZ                            [ BUY | SELL ]   │  title row + toggle
│ ┌─────────────────────┐ ┌─────────────────────┐          │
│ │ FURIA          60¢  │ │ MOUZ           41¢  │          │  outcome segments
│ └─────────────────────┘ └─────────────────────┘          │
│ ┌──────────────┐ ┌──────────────────────────────┐        │
│ │  −   $1   +  │ │  Trade $1   FURIA · 60¢       │        │  stepper + trade (1 row)
│ └──────────────┘ └──────────────────────────────┘        │
│ YOU HOLD 5 FURIA · $3.00                  [ SELL ]        │  holdings footer
└─────────────────────────────────────────────────────────┘
```

The primary space win is collapsing the **chips row + action row into a single
row** (stepper left, Trade button right) plus tighter paddings/fonts.

---

## 3. Components

### 3.1 Title row + BUY/SELL toggle (new)
- New flex row at the top of `.knoww-stream-bet`: market short title on the left
  (e.g. `FURIA vs MOUZ`), a `.knoww-stream-buysell` segmented toggle on the right.
- The toggle reuses the visual language of the panel's existing
  `.knoww-tp-buysell-toggle`.
- State: a `side: "BUY" | "SELL"` local to `buildStreamBetting`, defaulting to
  `BUY`. Switching re-renders segments, stepper, action, and footer.

### 3.2 Outcome segments (tightened)
- Keep the existing `.knoww-stream-seg` pills and their selection/color logic.
- Density only: padding `10px 12px → 8px 10px`, font `13px → 12px`, radius
  `11px → 9px`, gaps `8px → 6px`.
- Selecting an outcome sets `selectedIdx` (unchanged behavior).

### 3.3 −/＋ stepper (replaces preset chips)
- New `.knoww-stream-stepper`: `−` button, amount label (`$N`), `+` button.
- Mutates the existing module-level `streamStakeUsd` model so the settings
  default (`getStreamTradingSettings().defaultAmount`) and cross-card sharing
  still apply.
- Step `$1`. Clamped: floor at the dollar value of `ctx.minOrderSize` (so the
  resulting share count stays ≥ min order); ceiling at `ctx.balance` when funded.
- `STREAM_TRADE_AMOUNT_PRESETS` chips are removed from the card (the constant
  stays for the settings UI). `.knoww-stream-chips` CSS is removed.
- The stepper sits in the same row as the action button via a 2-column flex/grid;
  the stepper is fixed-width, the button flexes to fill.

### 3.4 Contextual action button (kept, restyled)
- The existing state machine in `renderAction()` is preserved verbatim:
  `ready → placing → placed → failed`, plus `connect / enable / insufficient
  (deposit) / approve / kalshi`.
- Density: padding `12px 14px → 9px 11px`, font `14px → 13px`.
- **Setup/long-label states** (`connect`, `enable`, `insufficient`, `approve`,
  `placing`, plus the inline deposit) **hide the stepper** and let the button span
  the full width, so longer labels (e.g. "Deposit to trade $20") always fit. The
  stepper is only shown in `ready` / `failed` / `placed` BUY states (where the
  amount is meaningful).

### 3.5 BUY/SELL semantics
- **BUY** (default): unchanged — market buy of the selected outcome via
  `submitStreamMarketOrder(market, opt, getStreamStake())`.
- **SELL**: market sell of the **selected outcome's entire held position** via
  `TradingService.placeOrder({ side: "SELL", … })`. The stepper is hidden in SELL
  mode (whole-position sell). Button label: `Sell N FURIA · ~$X`.
- SELL is **disabled with a hint** when the user holds none of the selected
  outcome, or the held size is below `minOrderSize`.
- Selling reuses `resolveOrderTokens` for the tokenId and `getOutcomeBalances`
  for the share size; on success it triggers the same `pollBalanceChange` +
  balance refresh as buys, and re-renders the footer.

### 3.6 Holdings + SELL footer (new)
- New `.knoww-stream-hold` footer fed by
  `TradingService.getOutcomeBalances(yesTokenId, noTokenId)` (already wired into
  the content script).
- **v1 content:** `YOU HOLD {shares} {outcome} · ${value}` where
  `value = shares × currentPrice` (via `positionValueUsd`). **No avg-cost / P&L
  in v1** — that data only exists in `/api/user/positions` (sidepanel-only) and is
  deferred. The footer is structured so an `@ {avgCost}¢ {±pnl}` segment can be
  added later without layout change.
- A `[SELL]` button on the right is a one-tap full-position sell of the held
  outcome (same path as 3.5 SELL).
- The footer is **hidden** when the user holds nothing in this market.
- If the user holds **both** outcomes (rare), the compact footer shows the single
  largest holding by current value (one line, to keep the panel small); the
  `[SELL]` sells that shown outcome. (A two-line both-sides footer is deferred.)
- The collapsed pill's holdings chip uses the same "largest single holding" rule.
- Token IDs for the balance lookup are resolved per market (via the same
  resolution `buildStreamBetting` already uses for orders); balances are fetched
  lazily when a card expands and refreshed after any fill.

### 3.7 Compact collapsed pill
- For `--stream` items only, replace the collapsed row's title + 2-line content +
  prices with a single dense line: status dot + `{A} {a}¢ / {B} {b}¢` + a
  holdings chip (`{shares} {outcome}`, only when held) + chevron.
- Implemented in the `isStream` branch of the notification-item builder
  (`ui.ts` ~3593). The expand/collapse accordion behavior is unchanged.
- Feed/non-stream rows keep their current collapsed layout untouched.

---

## 4. Density tokens (summary)

| Element | Before | After |
|---|---|---|
| seg padding | `10px 12px` | `8px 10px` |
| seg font / radius | `13px` / `11px` | `12px` / `9px` |
| trade btn padding / font | `12px 14px` / `14px` | `9px 11px` / `13px` |
| inter-row gap | `8px` | `6px` |
| amount selector | chips row (full width) | inline stepper (shares a row with the button) |

---

## 5. Files touched

- `apps/extension/src/content/ui.ts`
  - `buildStreamBetting()` — new title/toggle row, stepper, action-row layout,
    SELL path, holdings footer, lazy balance fetch.
  - notification-item builder `isStream` branch (~3593) — compact collapsed pill.
- `apps/extension/src/content/knoww-inline.css`
  - `.knoww-stream-*` block (~2210–2562) — new `.knoww-stream-buysell`,
    `.knoww-stream-stepper`, `.knoww-stream-hold`; tightened seg/action density;
    remove `.knoww-stream-chips`; compact collapsed-pill rules.

No changes to: feed injection, notification stack shell, full trading panel,
settings storage, or the streaming markets fetch driver (`stream-markets.ts`).

---

## 6. Out of scope (deferred)

- Avg-cost + P&L in the footer (needs `/api/user/positions` plumbed into the
  content script + market matching). Footer is built to accept it later.
- Partial-size selling (stepper-controlled sell). v1 sells whole position.
- BUY/SELL or stepper on the feed (non-stream) surface.

---

## 7. Testing

- Unit/DOM: `buildStreamBetting` renders the new rows; stepper clamps to
  min/balance; BUY vs SELL toggles button label/handler; footer hidden when no
  holdings, shown with shares + value when held; setup states hide the stepper.
- Reuse existing stream-widget tests as the harness; extend for the toggle,
  stepper, and footer.
- Manual: verify on a live Twitch stream across states (disconnected, connected
  no funds, funded, holding a position) and confirm the card is shorter than the
  current build at each state.
