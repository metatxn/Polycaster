# Extension Canonical Funding State Machine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One pure funding (deposit/withdraw) state machine driving both the sidepanel and the trading panel, with background-owned idempotency attempts and zero content-side money movement.

**Architecture:** Elm-style pure reducer (`machine.ts`) + effect-running controller (`controller.ts`) + transport gateway (`gateway.ts`) in a new `src/funding/` module shared by both webpack entries. Funding attempts (idempotency key + txHash + phase) are allocated and persisted by the background worker on top of the existing `portfolio-fund-idempotency` coordinator. Each surface keeps its own renderer and becomes `render(state)` + `dispatch(event)`.

**Tech Stack:** TypeScript, Decimal.js, chrome extension MV3 (background SW + sidepanel + content script), vitest (`apps/extension/tests/**/*.test.ts`, node environment).

**Spec:** `docs/superpowers/specs/2026-07-10-extension-funding-state-machine-design.md` — read it before starting any task.

## Global Constraints

- **NEVER run `git add` / `git commit` — the owner commits manually.** Skip every commit step you would normally add; leave all changes in the working tree.
- Monetary values are decimal strings or raw base-unit strings — never `number`. All arithmetic/comparisons via `Decimal` from `decimal.js`. Constructing `Decimal` from a `number` is prohibited in `src/funding/**`.
- `execute` (money movement) happens ONLY via background runtime messages. No `WalletBridge.sendTransaction`, no `wallet.sendTransaction` from content/sidepanel context for funding.
- Errors crossing the gateway are `{ code, message, retryable }` with codes from the allowlist in `types.ts`. No raw `Error.message` passthrough of internal exceptions to renderers.
- Every async effect result carries `{ epoch, effectId }`; the reducer drops results that don't match the active epoch + latest effectId for that effect kind.
- The passive bridge branch (`select-bridge-asset → bridge-address-ready`) must never reach `submitting`.
- Follow existing code style: biome, `createLogger("...")` for logs, no new dependencies.
- Gates after every task: `cd apps/extension && npx vitest run` and `npx tsc --noEmit` must pass.

---

### Task 1: Canonical DTOs + pure state machine + reducer tests

**Files:**
- Create: `apps/extension/src/funding/types.ts`
- Create: `apps/extension/src/funding/machine.ts`
- Create: `apps/extension/src/funding/index.ts`
- Test: `apps/extension/tests/funding/machine.test.ts`

**Interfaces:**
- Consumes: `decimal.js` only.
- Produces (later tasks rely on these exact names):
  `FundingState`, `FundingEvent`, `FundingEffect`, `FundingToken`,
  `FundingBridgeAsset`, `FundingQuote`, `FundingCommand`, `FundingAttempt`,
  `FundingError`, `FundingErrorCode`, `initialFundingState`,
  `reduceFunding(state, event): [FundingState, FundingEffect[]]`,
  `normalizeFundingAmount(raw: string): string | null`.

- [ ] **Step 1: Write `types.ts`** — complete file:

```ts
// apps/extension/src/funding/types.ts
// Canonical funding DTOs. Both surfaces map their local models into these at
// the gateway boundary; the machine never sees surface-specific shapes.
// Monetary values are decimal strings or raw base-unit strings — never number.

export type FundingFlow = "deposit" | "withdraw";
export type FundingMethod = "wallet" | "bridge";

export interface FundingToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  /** Raw base units as string, when the source knows it; else null. */
  balanceRaw: string | null;
  /** Human decimal string, e.g. "12.5". */
  balanceDisplay: string;
  /** USD estimate as decimal string; "0" when unknown. */
  usdValue: string;
  /** Minimum deposit in USD as decimal string; "0" when none. */
  minUsd: string;
  depositSupported: boolean;
  depositDisabledReason: string | null;
}

export interface FundingBridgeAsset {
  chainId: string;
  chainName: string;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  /** Decimal string. */
  minCheckoutUsd: string;
}

export interface FundingQuoteRequest {
  tokenAddress: string;
  tokenDecimals: number;
  /** Human decimal string. */
  amount: string;
}

export interface FundingQuote {
  quoteId: string;
  /** Estimated pUSD out, decimal string. */
  estOutputPusd: string;
  /** Estimated USD in, decimal string. */
  estInputUsd: string;
  /** Total fee impact in USD, decimal string. */
  totalImpactUsd: string;
}

export type FundingCommand =
  | {
      flow: "deposit";
      address: string;
      walletMode?: string;
      amount: string;
      chainId: string;
      tokenSymbol: string;
      tokenAddress: string;
      tokenDecimals: number;
    }
  | {
      flow: "withdraw";
      address: string;
      walletMode?: string;
      amount: string;
      destination: string;
      chainKey: string;
      tokenId: string;
    };

export type FundingAttemptPhase =
  | "none"        // allocated, nothing executed
  | "submitted"   // execute returned a txHash; receipt unknown
  | "credited"    // terminal success
  | "reverted";   // terminal failure (confirmed on-chain revert)

export interface FundingAttempt {
  attemptId: string;
  idempotencyKey: string;
  fingerprint: string;
  txHash: string | null;
  phase: FundingAttemptPhase;
}

export interface FundingExecutionResult {
  txHash: string;
}

export type FundingErrorCode =
  | "PENDING_RECONCILIATION"
  | "IDEMPOTENCY_FINGERPRINT_MISMATCH"
  | "NO_CONTENT_TAB"
  | "VALIDATION"
  | "LOAD_FAILED"
  | "QUOTE_FAILED"
  | "EXECUTION_FAILED"
  | "REVERTED"
  | "AMBIGUOUS_OUTCOME";

export interface FundingError {
  code: FundingErrorCode;
  message: string;
  retryable: boolean;
}

export interface FundingStatusResult {
  status: "pending" | "completed" | "failed";
  detail: string | null;
}
```

- [ ] **Step 2: Write the failing reducer tests** — `apps/extension/tests/funding/machine.test.ts`. Complete test file skeleton with every named case implemented (the cases below are the minimum; all must exist):

```ts
import { describe, expect, it } from "vitest";
import {
  initialFundingState,
  reduceFunding,
} from "../../src/funding/machine";
import type {
  FundingBridgeAsset,
  FundingEvent,
  FundingState,
  FundingToken,
} from "../../src/funding/types";

const token: FundingToken = {
  symbol: "USDC.e", name: "USD Coin", address: "0x" + "1".repeat(40),
  decimals: 6, balanceRaw: "25000000", balanceDisplay: "25",
  usdValue: "25", minUsd: "1", depositSupported: true,
  depositDisabledReason: null,
};
const asset: FundingBridgeAsset = {
  chainId: "1", chainName: "Ethereum", symbol: "ETH", name: "Ether",
  address: "native", decimals: 18, minCheckoutUsd: "20",
};

function drive(events: FundingEvent[]): FundingState {
  let state = initialFundingState;
  for (const event of events) [state] = reduceFunding(state, event);
  return state;
}

describe("deposit wallet path", () => {
  it("START deposit goes to method and requests nothing", () => {
    const [state, effects] = reduceFunding(initialFundingState, {
      type: "START", flow: "deposit",
    });
    expect(state.step).toBe("method");
    expect(effects).toEqual([]);
  });

  it("SELECT_METHOD wallet emits loadTokens with fresh effectId", () => {
    let state = initialFundingState;
    [state] = reduceFunding(state, { type: "START", flow: "deposit" });
    const [next, effects] = reduceFunding(state, {
      type: "SELECT_METHOD", method: "wallet",
    });
    expect(next.step).toBe("select-token");
    expect(effects[0].kind).toBe("loadTokens");
  });

  it("full happy path reaches confirm", () => { /* START → SELECT_METHOD wallet
    → TOKENS_LOADED → SELECT_TOKEN → SET_AMOUNT "5" → SUBMIT(from amount, valid)
    → confirm */ });
  it("SUBMIT from confirm emits beginAttempt effect and enters submitting", () => {});
  it("SUBMIT while submitting is a no-op (same state, no effects)", () => {});
  it("SUBMIT while confirming is a no-op", () => {});
  it("EXECUTED moves submitting → confirming with txHash", () => {});
  it("CREDITED moves confirming → done and emits completeAttempt effect", () => {});
  it("REVERT_CONFIRMED moves confirming → error(REVERTED, retryable:false) and emits completeAttempt", () => {});
});

describe("amount validation (decimal strings, no floats)", () => {
  it("rejects amount over balance (uses Decimal compare)", () => {});
  it("rejects amount below token minUsd", () => {});
  it("rejects malformed amounts: '1e5', '0x10', '1.2.3', '', '-1', '0'", () => {});
  it("accepts '0.000001' six-decimals amount", () => {});
});

describe("passive bridge branch", () => {
  it("SELECT_METHOD bridge emits loadBridgeAssets", () => {});
  it("SELECT_BRIDGE_ASSET emits resolveBridgeAddress and enters bridge-address-ready (loading)", () => {});
  it("BRIDGE_ADDRESS_READY stores the address", () => {});
  it("SUBMIT in bridge-address-ready is a no-op — branch can never reach submitting", () => {
    // exhaustive: from bridge-address-ready, apply every event type and assert
    // the resulting step is never "submitting"/"confirming".
  });
  it("SET_QUERY filters assets case-insensitively on symbol/name/chainName", () => {});
});

describe("withdraw path", () => {
  it("START withdraw goes to amount with destination fields", () => {});
  it("SET_AMOUNT + SET_DESTINATION then REQUEST_QUOTE emits fetchQuote", () => {});
  it("QUOTE_OK moves to confirm; SUBMIT emits beginAttempt", () => {});
  it("STATUS_UPDATE pending keeps confirming; completed → done", () => {});
});

describe("effect correlation", () => {
  it("drops TOKENS_LOADED with stale effectId", () => {});
  it("drops QUOTE_OK from a previous epoch after RESET + new START", () => {});
  it("drops STATUS_UPDATE for a superseded attempt after RETRY", () => {});
  it("ACCOUNT_CHANGED bumps epoch and returns to idle; in-flight results dropped", () => {});
});

describe("attempt lifecycle in machine", () => {
  it("ATTEMPT_READY with recorded txHash (phase submitted) skips execute and enters confirming", () => {});
  it("EXECUTION_FAILED ambiguous → error(AMBIGUOUS_OUTCOME, retryable:true); RETRY re-emits beginAttempt (same command)", () => {});
  it("EXECUTION_FAILED PENDING_RECONCILIATION → error, retryable:false", () => {});
  it("EXECUTION_FAILED IDEMPOTENCY_FINGERPRINT_MISMATCH → error, retryable:false", () => {});
  it("BACK is disabled from submitting/confirming", () => {});
});
```

Fill in every body — no empty `it` blocks may remain. Each follows the same
pattern: `drive([...events])` then assert `step`, state payload fields, and the
effects array of the final `reduceFunding` call.

- [ ] **Step 3: Run tests, verify they fail** — `cd apps/extension && npx vitest run tests/funding/machine.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 4: Write `machine.ts`** — complete implementation. Core skeleton (implement all branches; keep it pure — no Date, no crypto, no chrome):

```ts
// apps/extension/src/funding/machine.ts
import Decimal from "decimal.js";
import type {
  FundingAttempt, FundingBridgeAsset, FundingCommand, FundingError,
  FundingFlow, FundingMethod, FundingQuote, FundingStatusResult, FundingToken,
} from "./types";

const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;

/** Returns the canonical decimal string, or null when invalid/non-positive. */
export function normalizeFundingAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) return null;
  const value = new Decimal(trimmed);
  if (!value.isFinite() || value.lte(0)) return null;
  return value.toFixed();
}

interface Correlation {
  epoch: number;
  /** Latest effectId issued per effect kind; stale results are dropped. */
  latest: Partial<Record<FundingEffect["kind"], number>>;
  nextEffectId: number;
}

export type FundingState =
  | { step: "idle"; corr: Correlation }
  | { step: "method"; flow: "deposit"; corr: Correlation }
  | { step: "select-token"; loading: boolean; tokens: FundingToken[];
      error: FundingError | null; corr: Correlation }
  | { step: "select-bridge-asset"; loading: boolean;
      assets: FundingBridgeAsset[]; query: string;
      error: FundingError | null; corr: Correlation }
  | { step: "bridge-address-ready"; asset: FundingBridgeAsset;
      loading: boolean; depositAddress: string | null;
      error: FundingError | null; corr: Correlation }
  | { step: "amount"; flow: FundingFlow; token: FundingToken | null;
      amount: string; destination: string; chainKey: string; tokenId: string;
      quote: FundingQuote | null; quoteLoading: boolean;
      error: FundingError | null; corr: Correlation }
  | { step: "confirm"; command: FundingCommand; quote: FundingQuote | null;
      corr: Correlation }
  | { step: "submitting"; command: FundingCommand;
      attempt: FundingAttempt | null; corr: Correlation }
  | { step: "confirming"; command: FundingCommand; attempt: FundingAttempt;
      phase: "on-chain" | "credit" | "status"; corr: Correlation }
  | { step: "done"; txHash: string | null; corr: Correlation }
  | { step: "error"; error: FundingError; command: FundingCommand | null;
      attempt: FundingAttempt | null; corr: Correlation };

export type FundingEffect =
  | { kind: "loadTokens"; effectId: number; epoch: number }
  | { kind: "loadBridgeAssets"; effectId: number; epoch: number }
  | { kind: "resolveBridgeAddress"; effectId: number; epoch: number;
      asset: FundingBridgeAsset }
  | { kind: "fetchQuote"; effectId: number; epoch: number;
      tokenAddress: string; tokenDecimals: number; amount: string }
  | { kind: "beginAttempt"; effectId: number; epoch: number;
      command: FundingCommand }
  | { kind: "execute"; effectId: number; epoch: number;
      command: FundingCommand; attempt: FundingAttempt }
  | { kind: "awaitDepositCredit"; effectId: number; epoch: number;
      attempt: FundingAttempt }
  | { kind: "pollWithdrawStatus"; effectId: number; epoch: number;
      attempt: FundingAttempt }
  | { kind: "completeAttempt"; effectId: number; epoch: number;
      attempt: FundingAttempt; outcome: "credited" | "reverted" };

interface ResultMeta { epoch: number; effectId: number }

export type FundingEvent =
  | { type: "START"; flow: FundingFlow }
  | { type: "SELECT_METHOD"; method: FundingMethod }
  | { type: "SELECT_TOKEN"; token: FundingToken }
  | { type: "SELECT_BRIDGE_ASSET"; asset: FundingBridgeAsset }
  | { type: "SET_AMOUNT"; amount: string }
  | { type: "SET_QUERY"; query: string }
  | { type: "SET_DESTINATION"; destination: string; chainKey: string; tokenId: string }
  | { type: "REQUEST_QUOTE" }
  | { type: "BACK" }
  | { type: "SUBMIT" }
  | { type: "RETRY" }
  | { type: "RESET" }
  | { type: "ACCOUNT_CHANGED" }
  | ({ type: "TOKENS_LOADED"; tokens: FundingToken[] } & ResultMeta)
  | ({ type: "LOAD_FAILED"; error: FundingError } & ResultMeta)
  | ({ type: "ASSETS_LOADED"; assets: FundingBridgeAsset[] } & ResultMeta)
  | ({ type: "BRIDGE_ADDRESS_READY"; depositAddress: string } & ResultMeta)
  | ({ type: "QUOTE_OK"; quote: FundingQuote } & ResultMeta)
  | ({ type: "QUOTE_FAILED"; error: FundingError } & ResultMeta)
  | ({ type: "ATTEMPT_READY"; attempt: FundingAttempt } & ResultMeta)
  | ({ type: "EXECUTED"; txHash: string } & ResultMeta)
  | ({ type: "EXECUTION_FAILED"; error: FundingError } & ResultMeta)
  | ({ type: "CREDITED" } & ResultMeta)
  | ({ type: "REVERT_CONFIRMED" } & ResultMeta)
  | ({ type: "STATUS_UPDATE"; status: FundingStatusResult } & ResultMeta);

export const initialFundingState: FundingState = {
  step: "idle",
  corr: { epoch: 0, latest: {}, nextEffectId: 1 },
};

function issue(
  corr: Correlation,
  kind: FundingEffect["kind"]
): [Correlation, number] {
  const effectId = corr.nextEffectId;
  return [
    { ...corr, nextEffectId: effectId + 1,
      latest: { ...corr.latest, [kind]: effectId } },
    effectId,
  ];
}

function staleResult(
  corr: Correlation,
  kind: FundingEffect["kind"],
  meta: ResultMeta
): boolean {
  return meta.epoch !== corr.epoch || corr.latest[kind] !== meta.effectId;
}

export function reduceFunding(
  state: FundingState,
  event: FundingEvent
): [FundingState, FundingEffect[]] {
  // RESET / ACCOUNT_CHANGED: from any step, bump epoch, drop everything.
  if (event.type === "RESET" || event.type === "ACCOUNT_CHANGED") {
    return [{
      step: "idle",
      corr: { epoch: state.corr.epoch + 1, latest: {}, nextEffectId: state.corr.nextEffectId },
    }, []];
  }
  // ... implement every transition per the spec state diagram. Rules:
  // - Result events (those with ResultMeta) are dropped when
  //   staleResult(state.corr, <their effect kind>, event) is true.
  // - SUBMIT in "amount": validate via normalizeFundingAmount + Decimal
  //   balance/min checks; build FundingCommand; go to "confirm".
  //   (For sidepanel deposit — which has no separate confirm screen — the
  //   renderer immediately dispatches SUBMIT again from "confirm".)
  // - SUBMIT in "confirm": issue beginAttempt effect; go to "submitting"
  //   with attempt: null.
  // - ATTEMPT_READY in "submitting": if attempt.phase === "submitted" and
  //   attempt.txHash, skip execute — go straight to "confirming" and issue
  //   awaitDepositCredit (deposit) / pollWithdrawStatus (withdraw).
  //   Otherwise issue execute effect with the attempt.
  // - EXECUTED in "submitting": go to "confirming" (phase "credit" for
  //   deposit, "status" for withdraw) and issue the corresponding effect.
  // - CREDITED / STATUS_UPDATE completed: go to "done", issue
  //   completeAttempt(outcome: "credited").
  // - REVERT_CONFIRMED: go to "error" {code:"REVERTED", retryable:false},
  //   issue completeAttempt(outcome:"reverted").
  // - EXECUTION_FAILED: map to "error"; retryable only for
  //   AMBIGUOUS_OUTCOME / QUOTE_FAILED / LOAD_FAILED / EXECUTION_FAILED —
  //   never for PENDING_RECONCILIATION or IDEMPOTENCY_FINGERPRINT_MISMATCH.
  // - RETRY in "error": when error.retryable && command, re-issue
  //   beginAttempt(command) → "submitting" (the background returns the SAME
  //   attempt for the unchanged fingerprint, so retries resume, not repeat).
  // - BACK: amount→(select-token|select-bridge-asset|amount for withdraw idle),
  //   select-*→method, bridge-address-ready→select-bridge-asset,
  //   confirm→amount; ignored in submitting/confirming.
  // - bridge branch: SELECT_BRIDGE_ASSET issues resolveBridgeAddress →
  //   "bridge-address-ready"; SUBMIT there is a no-op.
  return [state, []]; // (unreached placeholder for the skeleton — implement fully)
}
```

Delete the trailing placeholder return once all branches are implemented; the
function must be exhaustive over `state.step` × `event.type` with a final
`return [state, []]` default for ignored combinations.

- [ ] **Step 5: Create `index.ts`** re-exporting everything public from `types.ts` and `machine.ts`.

- [ ] **Step 6: Run tests until green** — `npx vitest run tests/funding/machine.test.ts`. Expected: PASS, zero skipped.

- [ ] **Step 7: Typecheck** — `npx tsc --noEmit` (from `apps/extension`). Expected: clean. Do NOT commit.

---

### Task 2: Background attempt authority

**Files:**
- Create: `apps/extension/src/background/portfolio-fund-attempts.ts`
- Modify: `apps/extension/src/background.ts` (new message handlers + record txHash in the existing `KNOWW_PORTFOLIO_DEPOSIT`/`KNOWW_PORTFOLIO_WITHDRAW` handler, ~lines 1509–1660)
- Modify: `apps/extension/src/types/chrome-messages.ts` (new message types)
- Test: `apps/extension/tests/background/portfolio-fund-attempts.test.ts`

**Interfaces:**
- Consumes: `fingerprintPortfolioFundIntent`, `isPortfolioFundIdempotencyKey`, `PortfolioFundIntentInput` from `src/types/portfolio-fund-intent.ts`; the `PortfolioFundIdempotencyStorage` interface shape from `src/background/portfolio-fund-idempotency.ts`.
- Produces:
  - `createPortfolioFundAttemptStore(storage, now?, randomUuid?)` with methods
    `begin(input: PortfolioFundIntentInput): Promise<StoredFundAttempt>`,
    `recordExecution(attemptId: string, txHash: string): Promise<void>`,
    `complete(attemptId: string, outcome: "credited" | "reverted"): Promise<void>`.
  - `StoredFundAttempt = { attemptId: string; idempotencyKey: string; fingerprint: string; txHash: string | null; phase: "none" | "submitted" | "credited" | "reverted" }`.
  - Runtime messages: `KNOWW_PORTFOLIO_FUND_BEGIN_ATTEMPT` (payload: the `PortfolioFundIntentInput` fields; response `{ ok: true, data: StoredFundAttempt }`), `KNOWW_PORTFOLIO_FUND_COMPLETE_ATTEMPT` (payload `{ attemptId, outcome }`).
  - Existing `KNOWW_PORTFOLIO_DEPOSIT`/`KNOWW_PORTFOLIO_WITHDRAW` messages gain an optional `attemptId?: string`; on success the handler calls `recordExecution(attemptId, txHash)` before responding.

- [ ] **Step 1: Write failing tests** — cover, with a fake in-memory storage implementing `get/set/remove`:
  - `begin` allocates `attemptId` + valid uuid idempotency key and persists.
  - `begin` with the same normalized input returns the SAME attempt (same key), including after a simulated restart (new store over the same storage map).
  - `begin` with a different amount returns a different attempt.
  - `recordExecution` sets `txHash` + phase `submitted`; `begin` afterwards returns it (resume path).
  - `complete("credited")` retires the attempt: a subsequent `begin` with the same input allocates a FRESH attempt/key.
  - `complete("reverted")` likewise retires it.
  - terminal attempts are pruned by TTL (inject `now`).

Test pattern (write all cases in this style):

```ts
import { describe, expect, it } from "vitest";
import { createPortfolioFundAttemptStore } from "../../src/background/portfolio-fund-attempts";

function memoryStorage() {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key: string | null) {
      if (key === null) return Object.fromEntries(data);
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

const input = {
  action: "deposit" as const, address: "0x" + "a".repeat(40),
  amount: "5", chainId: "137", tokenSymbol: "USDC.e",
  tokenAddress: "0x" + "b".repeat(40), tokenDecimals: 6,
};

it("returns the same attempt for the same fingerprint across restarts", async () => {
  const storage = memoryStorage();
  const first = await createPortfolioFundAttemptStore(storage).begin(input);
  const second = await createPortfolioFundAttemptStore(storage).begin(input);
  expect(second.attemptId).toBe(first.attemptId);
  expect(second.idempotencyKey).toBe(first.idempotencyKey);
});
```

- [ ] **Step 2: Run tests, verify FAIL** (module not found).

- [ ] **Step 3: Implement `portfolio-fund-attempts.ts`.** Storage layout mirrors `portfolio-fund-idempotency.ts`: prefix `knoww_portfolio_fund_attempt_` + attemptId, records `{ version: 1, attemptId, idempotencyKey, fingerprint, txHash, phase, createdAt, updatedAt }`; a serialized `begin` (in-memory promise queue — the background SW is the single writer) that scans for a non-terminal record matching the fingerprint before allocating; TTL prune of terminal records (30 days / 50 records, same constants pattern as the coordinator). `begin` computes the fingerprint via `fingerprintPortfolioFundIntent`.

- [ ] **Step 4: Wire messages in `background.ts`.** Instantiate one store with `chrome.storage.local` next to `portfolioFundIdempotency` (~line 93). Add handlers in the same `onMessage` listener region as the existing portfolio messages (~line 1460): `KNOWW_PORTFOLIO_FUND_BEGIN_ATTEMPT` validates payload fields (strings/number checks like the existing handler), responds `{ ok: true, data }` or `{ ok: false, error }`; `KNOWW_PORTFOLIO_FUND_COMPLETE_ATTEMPT` validates `attemptId` + `outcome ∈ {credited, reverted}`. In the existing deposit/withdraw handler, thread `msg.attemptId` and call `recordExecution(msg.attemptId, data.txHash)` after `run` resolves (before `sendResponse`), guarded by `typeof msg.attemptId === "string"`. Add the two message shapes to `chrome-messages.ts` following the file's existing patterns.

- [ ] **Step 5: Run the new tests + full extension suite + typecheck.** Expected: all green. Do NOT commit.

---

### Task 3: Gateway interface + controller

**Files:**
- Create: `apps/extension/src/funding/gateway.ts`
- Create: `apps/extension/src/funding/controller.ts`
- Modify: `apps/extension/src/funding/index.ts` (re-export)
- Test: `apps/extension/tests/funding/controller.test.ts`

**Interfaces:**
- Consumes: Task 1 machine + types.
- Produces:

```ts
// gateway.ts — complete file
import type {
  FundingAttempt, FundingBridgeAsset, FundingCommand, FundingError,
  FundingExecutionResult, FundingQuote, FundingQuoteRequest,
  FundingStatusResult, FundingToken,
} from "./types";

export interface FundingGateway {
  loadWalletTokens(): Promise<FundingToken[]>;
  loadBridgeAssets(): Promise<FundingBridgeAsset[]>;
  resolveBridgeAddress(asset: FundingBridgeAsset): Promise<string>;
  fetchQuote(input: FundingQuoteRequest): Promise<FundingQuote>;
  /** Background-only. Allocates or resumes the attempt for this command. */
  beginAttempt(command: FundingCommand): Promise<FundingAttempt>;
  /** Background-only. Executes via KNOWW_PORTFOLIO_DEPOSIT / _WITHDRAW. */
  execute(command: FundingCommand, attempt: FundingAttempt): Promise<FundingExecutionResult>;
  awaitDepositCredit(attempt: FundingAttempt): Promise<"credited" | "reverted">;
  pollWithdrawStatus(attempt: FundingAttempt): Promise<FundingStatusResult>;
  /** Background-only. Marks the attempt terminal. */
  completeAttempt(attempt: FundingAttempt, outcome: "credited" | "reverted"): Promise<void>;
}

/** Gateways throw FundingGatewayError; anything else becomes a generic code. */
export class FundingGatewayError extends Error {
  readonly funding: FundingError;
  constructor(funding: FundingError) {
    super(funding.message);
    this.name = "FundingGatewayError";
    this.funding = funding;
  }
}
```

```ts
// controller.ts — public surface
export interface FundingController {
  getState(): FundingState;
  dispatch(event: FundingEvent): void;   // reduces, runs effects, re-renders
  subscribe(listener: (state: FundingState) => void): () => void;
  dispose(): void;                        // cancels timers; no events after
}
export function createFundingController(
  gateway: FundingGateway,
  options?: { quoteDebounceMs?: number; statusPollMs?: number }
): FundingController;
```

- [ ] **Step 1: Write failing controller tests** against a scripted fake gateway (every method a `vi.fn()` returning controllable promises). Required cases:
  - happy deposit: dispatching through the flow calls `beginAttempt` then `execute` then `awaitDepositCredit` then `completeAttempt("credited")`, ending in `done`.
  - resume: `beginAttempt` resolves `{ phase: "submitted", txHash: "0xabc" }` → `execute` is NEVER called; goes to confirming then done.
  - ambiguous: `execute` rejects with `FundingGatewayError({ code: "AMBIGUOUS_OUTCOME", ... })` → error state retryable; `RETRY` calls `beginAttempt` again with the SAME command; gateway returns same attempt; resume path (no second `execute` when phase is submitted).
  - `PENDING_RECONCILIATION` and `IDEMPOTENCY_FINGERPRINT_MISMATCH` rejections → non-retryable error states; `RETRY` does nothing.
  - `dispose()` while a quote promise is pending → resolving the promise afterwards does not invoke listeners (no event after disposal).
  - quote debounce: two `SET_AMOUNT` + `REQUEST_QUOTE` bursts within the debounce window produce ONE `fetchQuote` call (inject `quoteDebounceMs: 0`… use fake timers `vi.useFakeTimers()`).
  - stale poll: an older `pollWithdrawStatus` resolution arriving after `RETRY` does not transition the new attempt (assert via state).
  - non-`FundingGatewayError` rejections surface as `{ code: "EXECUTION_FAILED" }`-style structured errors — the raw message is logged, not rendered: state error message must be the generic safe copy `"Something went wrong. Your funds have not been moved twice."` for execute, `"Could not load data."` for reads.

- [ ] **Step 2: Run tests, verify FAIL.**

- [ ] **Step 3: Implement `controller.ts`.** Single `state` + listener set; `dispatch` runs `reduceFunding`, notifies, then executes returned effects async. Effect execution wraps every gateway call in try/catch: `FundingGatewayError` → its `funding` payload; anything else → generic safe error per the mapping above (log the original with `createLogger("funding.controller")`). Results are dispatched back as the matching result events carrying the effect's `{ epoch, effectId }` — the reducer's correlation guard does the dropping. `fetchQuote` goes through a debounce timer; `pollWithdrawStatus` re-issues itself on `pending` with `statusPollMs` delay while state is still `confirming` with the same attempt; `dispose()` sets a flag checked before every dispatch/notify and clears timers.

- [ ] **Step 4: Tests green, typecheck clean, full suite green.** Do NOT commit.

---

### Task 4: Sidepanel adoption

**Files:**
- Create: `apps/extension/src/funding/gateways/sidepanel-gateway.ts`
- Modify: `apps/extension/src/sidepanel.ts`
- Test: extend `apps/extension/tests/funding/controller.test.ts` only if gaps found; sidepanel has no dedicated suite — the gates are typecheck + full vitest + build.

**Interfaces:**
- Consumes: Tasks 1–3 exports; existing sidepanel helpers: `sendRuntimeMessage`, `PortfolioWalletToken` (line ~721), fund submit flow (`sendFundRequest` region ~1830–1950), `PENDING_RECONCILIATION` handling (~2023), withdraw quote/status messages (`KNOWW_PORTFOLIO_WITHDRAW_QUOTE`/`_STATUS`, ~1564/1629).
- Produces: `createSidepanelFundingGateway(deps)` where `deps = { sendRuntimeMessage, loadWalletTokens }` — mapping sidepanel transport onto `FundingGateway`.

- [ ] **Step 1: Write `sidepanel-gateway.ts`.** Map:
  - `loadWalletTokens` → existing sidepanel token source, each `PortfolioWalletToken` mapped to `FundingToken` (`amount`/`usdValue`/`minUsd` numbers converted via `new Decimal(String(value)).toFixed()` — this is the ONE permitted number→string bridge, at the boundary, documented inline).
  - `loadBridgeAssets`/`resolveBridgeAddress` → sidepanel currently has no passive-bridge UI; implement via the same runtime `fetch-json` transport used elsewhere or return `[]` + throw `FundingGatewayError({ code: "LOAD_FAILED", ... })` if unused by the sidepanel renderer (renderer never offers the bridge method when `loadBridgeAssets` rejects). Keep whichever the current sidepanel feature set implies — do not add a new visible method.
  - `fetchQuote`/`pollWithdrawStatus` → existing `KNOWW_PORTFOLIO_WITHDRAW_QUOTE` / `KNOWW_PORTFOLIO_WITHDRAW_STATUS` messages.
  - `beginAttempt` → `KNOWW_PORTFOLIO_FUND_BEGIN_ATTEMPT`; `completeAttempt` → `KNOWW_PORTFOLIO_FUND_COMPLETE_ATTEMPT`.
  - `execute` → existing `KNOWW_PORTFOLIO_DEPOSIT`/`KNOWW_PORTFOLIO_WITHDRAW` message + `attempt.idempotencyKey` + `attempt.attemptId`. Map `NO_CONTENT_TAB` and coordinator error strings to their `FundingErrorCode`s.
  - `awaitDepositCredit` → the sidepanel's existing post-deposit balance refresh mechanism.
- [ ] **Step 2: Replace sidepanel fund-flow state with a controller instance.** Delete: `portfolioFundIntentKeys` manager construction (~line 276) and its `getOrCreate`/`complete` call sites (~1856, 1931); the `portfolioFundView`/`portfolioDepositStep`/`portfolioDepositToken` variables and withdraw quote/status timers + run counters (~272–276, 750–755) — the controller/machine own all of it now. The render functions (`renderDepositMethod`, `renderDepositTokenList`, `renderDepositAmountStep`, `renderPortfolioFundForm`) stay, but read from `controller.getState()` (subscribe → re-render) and their event handlers call `controller.dispatch(...)`. Preserve the existing analytics calls at their equivalent transition points. Preserve `PENDING_RECONCILIATION` copy and the `NO_CONTENT_TAB` knoww.app-funds fallback.
- [ ] **Step 3: Gates.** `npx tsc --noEmit`, `npx vitest run`, `pnpm --filter @knoww/extension build:dev`. All green. Manually grep: `grep -n "portfolioFundIntentKeys" src/sidepanel.ts` → zero hits. Do NOT commit.

---

### Task 5: Trading-panel adoption + money-path switch

**Files:**
- Create: `apps/extension/src/funding/gateways/trading-panel-gateway.ts`
- Modify: `apps/extension/src/content/trading/trading-panel.ts`
- Modify (if signing-tab plumbing requires): none expected — the content tab is the sender, so the background's `resolvePortfolioSigningTabId` resolves it naturally.
- Test: update `apps/extension/tests/content/trading-panel-ux.test.ts` where it references deleted symbols.

**Interfaces:**
- Consumes: Tasks 1–3; existing content helpers: `safeSendMessage`/runtime messaging used by the panel, `fetchSupportedAssets`, `createDepositAddresses`, `fetchQuote` from `content/trading/bridge-api.ts`, `DepositToken` source (`loadDepositTokens` region), `waitForTxReceipt`, `refreshDepositBalanceUntilSynced`.
- Produces: `createTradingPanelFundingGateway(deps)`.

- [ ] **Step 1: Write `trading-panel-gateway.ts`.** Map:
  - `loadWalletTokens` → panel's existing wallet token loading; `DepositToken` → `FundingToken` (numbers → decimal strings at the boundary as in Task 4; prefer `amountRaw` when present).
  - `loadBridgeAssets` → `fetchSupportedAssets()`; `minCheckoutUsd` number → decimal string.
  - `resolveBridgeAddress(asset)` → `createDepositAddresses(proxyAddress)` + the existing matching logic (chainId + tokenSymbol match, else chainId match) currently inlined at ~4035–4053.
  - `fetchQuote` → bridge-api `fetchQuote` with `parseUnits(amount, decimals).toString()` for the base unit (this mirrors `depositFetchQuote` ~4064–4100 but takes the amount as a validated decimal string).
  - `beginAttempt`/`execute`/`completeAttempt` → runtime messages exactly as in Task 4 (`chrome.runtime.sendMessage` from content).
  - `awaitDepositCredit` → `waitForTxReceipt(txHash)` (revert → `"reverted"`) then `refreshDepositBalanceUntilSynced`/`fetchDepositStatus` polling → `"credited"`.
- [ ] **Step 2: Delete the content-side money path.** Remove from `trading-panel.ts`: `executeDeposit` (~4104–4230 incl. the `WalletBridge.sendTransaction` branches), `depositFetchQuote`, `startDepositFlow`'s state seeding, and ALL `deposit*` module state variables (`depositState`, `depositStep`, `depositMethod`, `depositTokens`, `depositSelected`, `depositAmount`, `depositError`, `depositBridgeAddress`, `depositRoute`, `depositBridgeAssets`, `depositSelectedBridgeAsset`, `depositBridgeSearchQuery`, `depositQuote`, `depositIsLoadingQuote`, `depositIsPending`, `depositIsConfirming`, `depositTxConfirmed`, `depositIsConfirmed`, `depositAddressesCache` — the full `let deposit…` block at ~233–250 and friends).
- [ ] **Step 3: Re-wire renderers.** `renderDepositForm` (~5253) creates/uses one controller (module-level singleton created lazily with the trading-panel gateway; `dispose()`d on panel close alongside `activeUnsubscribe`). `renderDepositMethodStep`/`renderDepositTokenStep`/`renderDepositBridgeSelectStep`/`renderDepositAmountStep`/`renderDepositConfirmStep` switch to reading `controller.getState()` and dispatching events; the confirm step renders the passive `bridge-address-ready` state for the bridge method (existing copy-address UI, unchanged markup) and the executable confirm for the wallet method. The inline deposit host (`inlineDepositHost`) re-render hook subscribes to the controller. Keep every `trackPanelAnalytics` call at its equivalent transition.
- [ ] **Step 4: Gates.** Full vitest + typecheck + `build:dev`. Greps must return zero: `grep -n "WalletBridge.sendTransaction" src/content/trading/trading-panel.ts`; `grep -rn "depositStep" src/ | grep -v funding/`. Do NOT commit.

---

### Task 6: Cross-context test, dead-code sweep, final gates

**Files:**
- Create: `apps/extension/tests/funding/cross-context.test.ts`
- Modify: `apps/extension/src/types/portfolio-fund-intent.ts` (delete `createPortfolioFundIntentKeyManager` and its interfaces IF no remaining callers; keep `fingerprintPortfolioFundIntent` + `isPortfolioFundIdempotencyKey` — the background uses them)
- Modify: whatever the sweep greps surface.

- [ ] **Step 1: Cross-context test.** Simulate both surfaces against ONE background: real `createPortfolioFundAttemptStore` + real `createPortfolioFundIdempotencyCoordinator` over one shared fake storage; two independent `createFundingController` instances with gateways whose `beginAttempt`/`execute` route into that shared store/coordinator (execute increments a `transfers` counter inside `coordinator.run`). Drive both controllers through the same deposit command concurrently. Assert `transfers === 1` and that the second surface lands in either `done` (replay) or the `PENDING_RECONCILIATION` error state — never a second execution.
- [ ] **Step 2: Dead-code sweep.** Greps (all from `apps/extension`):
  - `grep -rn "createPortfolioFundIntentKeyManager" src/` → only its own definition, or delete the function too.
  - `grep -rn "WalletBridge.sendTransaction" src/content/trading/` → zero funding hits (non-funding trading uses are out of scope — verify each remaining hit is order-signing, not funding).
  - `grep -rn "depositStep\|depositMethod\b" src/ --include="*.ts" | grep -v funding/` → zero.
  - `wc -l src/sidepanel.ts src/content/trading/trading-panel.ts` → record the shrinkage (spec target: ~500–800 lines combined).
- [ ] **Step 3: Full gates.** From repo root: `pnpm --filter @knoww/extension test`, `pnpm typecheck`, `pnpm --filter @knoww/extension build`. All green.
- [ ] **Step 4: Parity checklist** (manual code walk, record answers): wallet + bridge methods present; asset search; quote preview + loading; `minCheckoutUsd` floor; passive bridge address copy UI intact and non-executable; withdraw quote → execute → status; `NO_CONTENT_TAB` fallback; `PENDING_RECONCILIATION` copy on both surfaces; analytics events preserved. Do NOT commit — leave everything for owner review.

---

## Self-Review Notes

- Spec coverage: machine/DTO/correlation → Task 1; background attempt authority + resume/terminal semantics → Task 2; controller/dispose/debounce/safe errors → Task 3; surface adoptions + money-path switch + passive branch → Tasks 4–5; cross-context at-most-once + gates + parity → Task 6.
- Type names used across tasks were cross-checked: `FundingGateway` methods in Tasks 4–5 match the Task 3 interface; `StoredFundAttempt` fields match `FundingAttempt` plus persistence metadata.
- Commit steps intentionally omitted per owner rule (manual commits).
