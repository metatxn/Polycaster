# Guided trading setup — extension side panel + in-page card

- **Date:** 2026-06-23
- **Status:** Approved design, pending implementation plan
- **Surfaces:** `apps/extension` — side panel portfolio (`sidepanel.ts`) and the injected content trading card (`content/trading/trading-panel.ts`)

## Problem

The web app guides a new trader through a single 4-step onboarding wizard
(Connect wallet → Create trading vault → Approve permissions → Generate API keys)
that strictly gates each step on the previous one. See
`apps/web/src/components/trading-onboarding.tsx`.

The extension does not replicate this. Two separate, thinner surfaces let a user
set up trading, and historically neither walked a first-timer through the journey:

- **Side panel portfolio** (`sidepanel.ts`) — a two-button gate
  (`renderPortfolioTradingGate`): "Create trading wallet" → "Enable trading".
  Approvals are deferred to first trade; funding is a separate Deposit button.
- **In-page content card** (`trading-panel.ts`) — inline `addDeploySafe` →
  `addEnableTrading` sections that deploy the vault and mint CLOB credentials
  directly from the card.

The uncommitted `content/trading/setup-gates.ts` already enforces
deploy-before-credentials ordering in `TradingService`, but:

1. Neither surface is a guided, step-by-step flow for someone with no prior
   knowledge of the extension.
2. There is no explicit "Approve permissions" step (web has one).
3. The two surfaces implement setup independently and can drift.
4. Funding is never part of the guided journey, so a fully "set up" user still
   has $0 cash and cannot actually trade.

## Goals

- Replicate the web onboarding as a **guided, step-by-step flow** on **both**
  extension surfaces, assuming the user knows nothing about the extension.
- Extend it end-to-end so a brand-new user goes from zero to *able to place a
  trade* — including funding.
- Make the two surfaces share one brain so they gate identically and cannot drift.

## Non-goals

- No change to how the relayer / CLOB actually deploy the vault, derive
  credentials, or set allowances.
- No redesign of the deposit mechanics — both surfaces just launch their existing
  deposit UI.
- No change to the in-page card's order/split/merge forms beyond the setup region.

## Decisions (resolved during brainstorming)

1. **Explicit Approve step (full parity).** The flow includes an explicit
   "Approve permissions" step with a USDC allowance-limit input, matching web —
   not the current "defer to first trade" behaviour.
2. **Funding is a guided step.** A 5th "Add funds" step is appended after API
   keys, because a connected + approved + credentialed user still has $0 and
   cannot trade. This intentionally goes one step beyond web's 4.
3. **Side panel is dismissible + resumable.** The wizard can collapse to a slim
   "Finish setting up trading · step N of 5" banner; progress is remembered.
4. **Both surfaces host the full flow.** The in-page card mirrors the 5-step flow
   inline (it is not merely a redirect to the side panel), so a user can set up
   without leaving the page.

## The five steps

| # | id | Label | "Done" when | Helper copy (first-timer language) |
|---|------|-------|-------------|-------------------------------------|
| 1 | `connect` | Connect wallet | a wallet session exists | "Link the wallet you'll fund and trade with." |
| 2 | `vault` | Create trading vault | proxy deployed on-chain | "Deploy your gas-free Knoww vault — Knoww settles trades through it." |
| 3 | `approve` | Approve permissions | allowance ≥ default threshold | "Allow Knoww to move USDC for your trades. One signature." |
| 4 | `credentials` | Generate API keys | CLOB credentials exist | "Sign once to mint your private trading keys." |
| 5 | `funds` | Add funds | cash balance > 0 | "Add USDC so you can place your first trade." |

Final copy is refined during implementation; the table fixes intent and ordering.

## Architecture

### 1. Shared step model — the anti-drift core

New module: **`apps/extension/src/content/trading/setup-flow.ts`** (pure, no DOM,
no chrome APIs). It owns step definitions, ordering, copy, and status derivation.
Both surfaces import it, so they cannot disagree on the current step or gating.

```ts
export type SetupStepId =
  | "connect" | "vault" | "approve" | "credentials" | "funds";
export type SetupStepStatus = "done" | "now" | "pending";

export interface SetupFlowState {
  hasSession: boolean;       // connect
  address?: string | null;
  proxyAddress?: string | null;
  walletMode?: string | null;
  isDeployed?: boolean | null; // vault
  hasApproval: boolean;        // approve  (allowance >= threshold)
  hasCredentials: boolean;     // credentials
  cashBalance: number;         // funds
}

export interface SetupStep {
  id: SetupStepId;
  label: string;
  helper: string;
  status: SetupStepStatus;
}

export interface SetupFlow {
  steps: SetupStep[];
  currentStepId: SetupStepId | null; // first non-done step
  isComplete: boolean;               // all five done
}

export function deriveSetupFlow(state: SetupFlowState): SetupFlow;
```

Rules:

- A step is `done` per the "Done when" column above.
- `currentStepId` = the first step that is not `done`. That step is `now`.
- Every step after `now` is `pending` (locked) — identical to web's `stateFor`.
- This **absorbs and extends `setup-gates.ts`**: the deploy-before-credentials
  rule is just "credentials cannot be `now` while `vault` is not `done`," which
  falls out of the ordering. `setup-gates.ts` predicates (`hasDeployedTradingWallet`,
  `isTradingWalletDeploymentRequired`, `isTradingSetupComplete`) are re-expressed
  in / re-exported from `setup-flow.ts` so existing call sites keep working.

`hasApproval` is `allowance >= DEFAULT_TRADING_APPROVAL`. The allowance value is
read via the existing background `trading:get-all-allowances` handler (side panel)
and from `ctx` allowance fields the card already tracks (content card).

### 2. Per-surface action bindings

The model and copy are shared; each surface binds the five steps to its own
action layer. Only the action invocation differs.

| Step | Side panel action | Content card action |
|------|-------------------|---------------------|
| 1 Connect | `connectPortfolioWallet` / `connectPortfolioWalletConnect` | existing card connect flow |
| 2 Vault | `deployPortfolioTradingWallet` → `trading:deploy-safe` | `TradingService.deployWallet()` |
| 3 Approve | **new** `approvePortfolioTrading(owner, limit)` → `trading:relayer-approve` `{ address, walletMode, approvalAmount }` | `TradingService.approveUsdc(negRisk, amount)` |
| 4 API keys | `enablePortfolioTrading` → `KNOWW_ENABLE_PORTFOLIO_TRADING` | `TradingService.deriveCredentials()` |
| 5 Funds | existing deposit flow (`setDepositStep("method")`) | card deposit view (`activeView === "deposit"` → `renderDepositForm`) |

`trading:relayer-approve` and `TradingService.approveUsdc` already exist (they
back the order-time "Approve pUSD" CTA) and both floor the amount at
`DEFAULT_TRADING_APPROVAL`, so step 3 is new UI over an existing rail — no new
on-chain logic.

### 3. Side panel rendering — three modes

Computed from `deriveSetupFlow(state)` plus a per-address `dismissed` flag.

| Mode | When | Renders |
|------|------|---------|
| **Expanded wizard** | `!isComplete && !dismissed` | Hero (identity + $0) → progress rail + active step card. Deposit/Withdraw buttons and the positions table are hidden (not usable yet; the wizard owns funding). |
| **Collapsed banner** | `!isComplete && dismissed` | Hero → slim `Finish setting up trading · step N of 5 →` banner → normal portfolio (Deposit/Withdraw + Positions/Orders/History tabs). Tapping the banner clears `dismissed` and reopens the wizard at `currentStepId`. |
| **Complete** | `isComplete` | Today's normal portfolio. No wizard, no banner. |

The **Connect step is special**: when signed out there is no portfolio session,
so the wizard shell renders with step 1 active and the existing wallet picker
(`renderPortfolioWalletChoices` / WalletConnect QR) as its body. This replaces
today's bare `renderPortfolioSignedOut` so the very first screen a new user sees
is step 1 of the guided flow. On connect → reload → step 1 becomes `done`, step 2
becomes `now`.

Render placement: the wizard/banner slots into the portfolio content where
`renderPortfolioTradingGate` is today (between the hero and the table), so the
existing layout pipeline (`renderPortfolioContent`) is preserved.

### 4. Content card rendering — compact stepped flow

The card's setup region (today's `addDeploySafe` / `addEnableTrading` branches in
the main render switch, ~`trading-panel.ts:5199-5238`) is replaced by a compact
renderer driven by the shared model:

- A thin progress rail (`●—●—○—○—○`) showing all five steps.
- The active step's card: a button (vault, credentials), an allowance-limit input
  + Approve button (approve), the wallet picker (connect), or the card's existing
  deposit view (funds).
- No dismiss/banner on the card — it is opened intentionally to trade, so it shows
  the current step until the flow is complete, then renders the order form.
- The wallet-mode selector (`addWalletModeSelector`) stays attached to the vault
  step where it is relevant today.

Order-time **"Approve pUSD" top-up stays** as an ongoing fallback. Allowances
deplete with use; a user past setup must be able to re-approve at order time
without re-entering the wizard. The setup `approve` step and the order-time
top-up are distinct and coexist.

### 5. Persistence

`portfolioSetupDismissed` is stored per owner address in `chrome.storage.local`
(same pattern as `readStoredWalletMode`) so a user who skips and reloads still
sees the banner, not a reset wizard. It is cleared automatically once
`deriveSetupFlow(...).isComplete` is true. It governs only the side panel's
expanded/banner toggle. Vault/approval/credential/funds state is always read live
on both surfaces.

### 6. Data plumbing

- `PortfolioData` (side panel) gains `hasApproval: boolean`, populated in
  `loadPortfolio` via `trading:get-all-allowances`. `cashBalance`, `walletMode`,
  `hasTradingWallet`, `hasTradingCredentials` already exist.
- The content card already tracks allowance, deployment, credentials, and (via
  balance) cash in `TradingContext`; the card maps `ctx` → `SetupFlowState`.

### 7. Isolation / file structure

`sidepanel.ts` is ~5,750 lines and `trading-panel.ts` is large; keep the new
surface area focused.

- **New** `content/trading/setup-flow.ts` — shared model, derivation, copy,
  re-exported gate predicates. Pure and unit-tested.
- **New** `content/trading/portfolio-setup.ts` (or co-located) — side panel
  wizard/banner render helpers returning HTML strings; `sidepanel.ts` keeps only
  the thin event wiring.
- `trading-panel.ts` — replace the two inline gate functions with a compact
  step-card renderer that reads the shared model.

## Error handling

Each step has an inline error slot, reusing the existing per-surface error
channels (`portfolioTradingError` in the side panel; `ctx.error` / rich error
toast in the card). A failed deploy/approve/derive shows the error on that step
with a Retry affordance and does not advance `currentStepId`. This matches the
existing handlers, which set the error and re-render the same step.

## Testing

- **Unit (`setup-flow.test.ts`)** — `deriveSetupFlow` across every state combo:
  signed-out, connected-only, deployed-no-approval, approved-no-creds,
  credentialed-unfunded, complete; assert `currentStepId`, per-step status, and
  `isComplete`. This is the cross-surface consistency guarantee.
- **Render** — side panel: the three modes (expanded / banner / complete) and the
  signed-out connect shell; content card: compact flow at each step. String-based,
  matching the existing `tests/content/sidepanel-controls.test.ts` style.
- Keep / fold in the existing `trading-setup-gates.test.ts` assertions via the
  re-exported predicates.

## Visual / editorial

- Functional UI: upright Fraunces / mono / sans, **no italics** (italics reserved
  for hero titles and narrative empty states per the project's editorial rule).
- No `+` prefix on positive P&L in the hero (existing rule; unaffected but
  preserved).
- The progress rail and step cards reuse the side panel's `knoww-pf-*` /
  `knoww-tp-*` CSS idioms rather than introducing a new visual system.

## Open questions for the plan

- Exact `DEFAULT_TRADING_APPROVAL` threshold to treat the approve step as `done`,
  and the default value shown in the allowance input (web defaults to 100 USDC).
- Whether the side panel's `funds` step should mark `done` on any positive balance
  or require a successful deposit round-trip (default: any positive cash balance).
