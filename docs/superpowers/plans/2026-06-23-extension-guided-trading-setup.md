# Guided Trading Setup (Extension) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give both extension trading surfaces — the side panel portfolio (`sidepanel.ts`) and the in-page content card (`trading-panel.ts`) — a single, guided, step-by-step setup flow (Connect → Create vault → Approve → Generate API keys → Add funds) that mirrors the web onboarding and walks a first-time user from zero to able-to-trade.

**Architecture:** A pure, shared step model (`setup-flow.ts`) is the single source of truth for step order, copy, gating, and completion. Each surface renders that model and binds the five steps to its own existing action layer (side panel → runtime messages; content card → `TradingService`). A tiny per-address persistence module remembers "dismissed" and "completed" so the flow doesn't nag or resurrect.

**Tech Stack:** TypeScript, Chrome MV3 extension, string-template DOM rendering, viem (background), Vitest (node env), pnpm workspaces.

## Global Constraints

Every task's requirements implicitly include these:

- **User commits manually.** Do NOT run `git add` or `git commit`. Each task ends with a verification checkpoint; leave all changes uncommitted for the user to review.
- **Single source of truth.** Both surfaces MUST import step order / copy / status from `setup-flow.ts`. Never duplicate step logic in `sidepanel.ts` or `trading-panel.ts`.
- **Step order is the gate.** A step is `now` only when every earlier step is `done`. This preserves the existing deploy-before-credentials rule from `setup-gates.ts` (credentials can never be `now` while `vault` is not `done`).
- **Approval default = `100`** USDC (`DEFAULT_APPROVAL_AMOUNT` from `@knoww/shared-types/trading`). The approve step counts as `done` when on-chain allowance `> 0`.
- **Funds step `done` when cash balance `> 0`.**
- **Order-time "Approve pUSD" top-up stays.** The card's existing inline approve-at-order-time path (`trading-panel.ts` ~2638, `TradingService.approveUsdc`) MUST remain untouched; it is distinct from the setup approve step.
- **Editorial — no italics in functional UI.** The wizard, progress rail, step cards, and banner are functional UI: use upright Fraunces / mono / sans only. Italic Fraunces is reserved for hero titles and narrative empty states.
- **No `+` prefix on positive P&L.** (Unaffected here, but preserve in any hero you touch.)
- **Tests:** Vitest, `environment: "node"`, files under `apps/extension/tests/**/*.test.ts`, using `import assert from "node:assert/strict"` and `import { test } from "vitest"` (match `tests/content/trading-setup-gates.test.ts`).
- **Run a single test file:** `pnpm --filter @knoww/extension exec vitest run tests/content/<file>.test.ts`
- **Typecheck:** `pnpm --filter @knoww/extension run typecheck`

---

## File Structure

**New files:**
- `apps/extension/src/content/trading/setup-flow.ts` — pure shared model: types, step defs + copy, `deriveSetupFlow`, `resolveSetupSurfaceMode`, `isApprovalSufficientForSetup`, re-exported `SETUP_APPROVAL_DEFAULT`. Builds on top of `setup-gates.ts` (imports `hasDeployedTradingWallet`).
- `apps/extension/src/content/trading/setup-flow-storage.ts` — per-address `chrome.storage.local` wrappers for `dismissed` + `complete` flags. Env-guarded.
- `apps/extension/src/content/trading/portfolio-setup-view.ts` — side panel HTML-string renderers (progress rail, step card, banner, connect shell). No chrome / DOM access; returns strings.
- `apps/extension/tests/content/setup-flow.test.ts`
- `apps/extension/tests/content/setup-flow-storage.test.ts`
- `apps/extension/tests/content/portfolio-setup-view.test.ts`

**Modified files:**
- `apps/extension/src/sidepanel.ts` — add `hasApproval` to `PortfolioData` + fetch in `loadPortfolio`; render the wizard/banner/connect shell via `portfolio-setup-view.ts`; add `approvePortfolioTrading` handler + funds routing + dismiss/resume + completion persistence; replace `renderPortfolioTradingGate` call site.
- `apps/extension/src/content/trading/trading-panel.ts` — replace the `addDeploySafe` / `addEnableTrading` render branches with a compact `addSetupFlow` driven by the shared model (adds approve + funds steps); keep order-time top-up.

**Unchanged (depended on):** `setup-gates.ts` (kept as-is; `setup-flow.ts` imports from it), `background/trading-handler.ts` (`trading:deploy-safe`, `trading:relayer-approve`, `trading:get-allowance`, `KNOWW_ENABLE_PORTFOLIO_TRADING` already exist), `TradingService` (`deployWallet`, `approveUsdc`, `deriveCredentials` already exist).

---

## Task 1: Shared step model (`setup-flow.ts`)

**Files:**
- Create: `apps/extension/src/content/trading/setup-flow.ts`
- Test: `apps/extension/tests/content/setup-flow.test.ts`

**Interfaces:**
- Consumes: `hasDeployedTradingWallet`, `TradingWalletSetupState` from `./setup-gates`; `DEFAULT_APPROVAL_AMOUNT` from `@knoww/shared-types/trading`.
- Produces:
  - `type SetupStepId = "connect" | "vault" | "approve" | "credentials" | "funds"`
  - `type SetupStepStatus = "done" | "now" | "pending"`
  - `type SetupSurfaceMode = "wizard" | "banner" | "complete"`
  - `interface SetupFlowState extends TradingWalletSetupState { hasSession: boolean; hasApproval: boolean; hasCredentials: boolean; cashBalance: number; }`
  - `interface SetupStep { id: SetupStepId; index: number; label: string; helper: string; status: SetupStepStatus; }`
  - `interface SetupFlow { steps: SetupStep[]; currentStepId: SetupStepId | null; currentIndex: number; totalSteps: number; isComplete: boolean; }`
  - `function deriveSetupFlow(state: SetupFlowState): SetupFlow`
  - `function resolveSetupSurfaceMode(args: { flow: SetupFlow; persistedComplete: boolean; dismissed: boolean }): SetupSurfaceMode`
  - `function isApprovalSufficientForSetup(allowanceUsd: number): boolean`
  - `const SETUP_APPROVAL_DEFAULT: string` (= `"100"`)

- [ ] **Step 1: Write the failing test**

Create `apps/extension/tests/content/setup-flow.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  deriveSetupFlow,
  isApprovalSufficientForSetup,
  resolveSetupSurfaceMode,
  SETUP_APPROVAL_DEFAULT,
  type SetupFlowState,
} from "../../src/content/trading/setup-flow";

const complete: SetupFlowState = {
  hasSession: true,
  address: "0x0000000000000000000000000000000000000001",
  proxyAddress: "0x0000000000000000000000000000000000000002",
  walletMode: "deposit",
  isDeployed: true,
  hasApproval: true,
  hasCredentials: true,
  cashBalance: 5,
};

test("default approval cap is 100 USDC", () => {
  assert.equal(SETUP_APPROVAL_DEFAULT, "100");
});

test("a fully set-up + funded user has no current step and is complete", () => {
  const flow = deriveSetupFlow(complete);
  assert.equal(flow.isComplete, true);
  assert.equal(flow.currentStepId, null);
  assert.equal(flow.totalSteps, 5);
  assert.ok(flow.steps.every((s) => s.status === "done"));
});

test("a brand-new user starts at connect; later steps are locked", () => {
  const flow = deriveSetupFlow({ ...complete, hasSession: false, address: null });
  assert.equal(flow.currentStepId, "connect");
  assert.equal(flow.currentIndex, 1);
  assert.equal(flow.steps[0].status, "now");
  assert.ok(flow.steps.slice(1).every((s) => s.status === "pending"));
  assert.equal(flow.isComplete, false);
});

test("deployed vault without approval lands on the approve step", () => {
  const flow = deriveSetupFlow({ ...complete, hasApproval: false });
  assert.equal(flow.currentStepId, "approve");
  assert.equal(flow.steps.find((s) => s.id === "vault")?.status, "done");
  assert.equal(flow.steps.find((s) => s.id === "approve")?.status, "now");
  assert.equal(flow.steps.find((s) => s.id === "credentials")?.status, "pending");
});

test("credentials cannot be current while the vault is undeployed (gate)", () => {
  const flow = deriveSetupFlow({
    ...complete,
    isDeployed: false,
    hasApproval: false,
    hasCredentials: true, // even if creds somehow exist
  });
  assert.equal(flow.currentStepId, "vault");
});

test("set-up but unfunded user lands on the funds step", () => {
  const flow = deriveSetupFlow({ ...complete, cashBalance: 0 });
  assert.equal(flow.currentStepId, "funds");
  assert.equal(flow.isComplete, false);
});

test("approval is sufficient only for a positive allowance", () => {
  assert.equal(isApprovalSufficientForSetup(0), false);
  assert.equal(isApprovalSufficientForSetup(0.5), true);
  assert.equal(isApprovalSufficientForSetup(Number.NaN), false);
});

test("surface mode: complete wins, then dismissed → banner, else wizard", () => {
  const incomplete = deriveSetupFlow({ ...complete, cashBalance: 0 });
  assert.equal(
    resolveSetupSurfaceMode({ flow: incomplete, persistedComplete: true, dismissed: false }),
    "complete"
  );
  assert.equal(
    resolveSetupSurfaceMode({ flow: deriveSetupFlow(complete), persistedComplete: false, dismissed: false }),
    "complete"
  );
  assert.equal(
    resolveSetupSurfaceMode({ flow: incomplete, persistedComplete: false, dismissed: true }),
    "banner"
  );
  assert.equal(
    resolveSetupSurfaceMode({ flow: incomplete, persistedComplete: false, dismissed: false }),
    "wizard"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @knoww/extension exec vitest run tests/content/setup-flow.test.ts`
Expected: FAIL — `Cannot find module '../../src/content/trading/setup-flow'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/extension/src/content/trading/setup-flow.ts`:

```ts
import { DEFAULT_APPROVAL_AMOUNT } from "@knoww/shared-types/trading";

import {
  hasDeployedTradingWallet,
  type TradingWalletSetupState,
} from "./setup-gates";

export type SetupStepId =
  | "connect"
  | "vault"
  | "approve"
  | "credentials"
  | "funds";

export type SetupStepStatus = "done" | "now" | "pending";
export type SetupSurfaceMode = "wizard" | "banner" | "complete";

export interface SetupFlowState extends TradingWalletSetupState {
  /** A portfolio/wallet session is resolved (connect step). */
  hasSession: boolean;
  /** On-chain allowance is positive (approve step). */
  hasApproval: boolean;
  /** CLOB credentials exist (credentials step). */
  hasCredentials: boolean;
  /** Spendable cash balance in USD (funds step). */
  cashBalance: number;
}

export interface SetupStep {
  id: SetupStepId;
  index: number; // 1-based
  label: string;
  helper: string;
  status: SetupStepStatus;
}

export interface SetupFlow {
  steps: SetupStep[];
  currentStepId: SetupStepId | null;
  currentIndex: number; // 1-based; equals totalSteps when complete
  totalSteps: number;
  isComplete: boolean;
}

/** Default ERC-20 approval cap shown in the allowance input (USDC). */
export const SETUP_APPROVAL_DEFAULT = DEFAULT_APPROVAL_AMOUNT;

export function isApprovalSufficientForSetup(allowanceUsd: number): boolean {
  return Number.isFinite(allowanceUsd) && allowanceUsd > 0;
}

interface StepDef {
  id: SetupStepId;
  label: string;
  helper: string;
  done: (s: SetupFlowState) => boolean;
}

const STEP_DEFS: StepDef[] = [
  {
    id: "connect",
    label: "Connect wallet",
    helper: "Link the wallet you'll fund and trade with.",
    done: (s) => s.hasSession && Boolean(s.address),
  },
  {
    id: "vault",
    label: "Create trading vault",
    helper: "Deploy your gas-free Knoww vault — Knoww settles trades through it.",
    done: (s) => hasDeployedTradingWallet(s),
  },
  {
    id: "approve",
    label: "Approve permissions",
    helper: "Allow Knoww to move USDC for your trades. One signature.",
    done: (s) => s.hasApproval,
  },
  {
    id: "credentials",
    label: "Generate API keys",
    helper: "Sign once to mint your private trading keys.",
    done: (s) => s.hasCredentials,
  },
  {
    id: "funds",
    label: "Add funds",
    helper: "Add USDC so you can place your first trade.",
    done: (s) => s.cashBalance > 0,
  },
];

export function deriveSetupFlow(state: SetupFlowState): SetupFlow {
  let currentStepId: SetupStepId | null = null;
  let currentIndex = STEP_DEFS.length;

  const steps: SetupStep[] = STEP_DEFS.map((def, i) => {
    const isDone = def.done(state);
    let status: SetupStepStatus;
    if (isDone) {
      status = "done";
    } else if (currentStepId === null) {
      status = "now";
      currentStepId = def.id;
      currentIndex = i + 1;
    } else {
      status = "pending";
    }
    return {
      id: def.id,
      index: i + 1,
      label: def.label,
      helper: def.helper,
      status,
    };
  });

  return {
    steps,
    currentStepId,
    currentIndex,
    totalSteps: STEP_DEFS.length,
    isComplete: currentStepId === null,
  };
}

export function resolveSetupSurfaceMode(args: {
  flow: SetupFlow;
  persistedComplete: boolean;
  dismissed: boolean;
}): SetupSurfaceMode {
  if (args.persistedComplete || args.flow.isComplete) return "complete";
  return args.dismissed ? "banner" : "wizard";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @knoww/extension exec vitest run tests/content/setup-flow.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck + checkpoint (no commit)**

Run: `pnpm --filter @knoww/extension run typecheck`
Expected: no errors. Leave changes uncommitted for the user to review.

---

## Task 2: Per-address persistence (`setup-flow-storage.ts`)

**Files:**
- Create: `apps/extension/src/content/trading/setup-flow-storage.ts`
- Test: `apps/extension/tests/content/setup-flow-storage.test.ts`

**Interfaces:**
- Produces:
  - `function readSetupComplete(address: string): Promise<boolean>`
  - `function markSetupComplete(address: string): Promise<void>`
  - `function readSetupDismissed(address: string): Promise<boolean>`
  - `function writeSetupDismissed(address: string, dismissed: boolean): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `apps/extension/tests/content/setup-flow-storage.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import {
  markSetupComplete,
  readSetupComplete,
  readSetupDismissed,
  writeSetupDismissed,
} from "../../src/content/trading/setup-flow-storage";

// Minimal in-memory chrome.storage.local stub.
function installChromeStub(): Record<string, unknown> {
  const store: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (key: string, cb: (r: Record<string, unknown>) => void) =>
          cb({ [key]: store[key] }),
        set: (items: Record<string, unknown>, cb: () => void) => {
          Object.assign(store, items);
          cb();
        },
      },
    },
  };
  return store;
}

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

const ADDR = "0xAbC0000000000000000000000000000000000001";

test("complete flag defaults false, persists true, and is case-insensitive", async () => {
  installChromeStub();
  assert.equal(await readSetupComplete(ADDR), false);
  await markSetupComplete(ADDR);
  assert.equal(await readSetupComplete(ADDR.toLowerCase()), true);
});

test("dismissed flag round-trips per address", async () => {
  installChromeStub();
  assert.equal(await readSetupDismissed(ADDR), false);
  await writeSetupDismissed(ADDR, true);
  assert.equal(await readSetupDismissed(ADDR), true);
  await writeSetupDismissed(ADDR, false);
  assert.equal(await readSetupDismissed(ADDR), false);
});

test("reads default false when chrome is unavailable", async () => {
  // no stub installed
  assert.equal(await readSetupComplete(ADDR), false);
  assert.equal(await readSetupDismissed(ADDR), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @knoww/extension exec vitest run tests/content/setup-flow-storage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/extension/src/content/trading/setup-flow-storage.ts`:

```ts
const completeKey = (address: string) =>
  `knoww:setup-complete:${address.toLowerCase()}`;
const dismissedKey = (address: string) =>
  `knoww:setup-dismissed:${address.toLowerCase()}`;

function storageGet(key: string): Promise<unknown> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      resolve(undefined);
      return;
    }
    chrome.storage.local.get(key, (result) => resolve(result?.[key]));
  });
}

function storageSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      resolve();
      return;
    }
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

export async function readSetupComplete(address: string): Promise<boolean> {
  return (await storageGet(completeKey(address))) === true;
}

export async function markSetupComplete(address: string): Promise<void> {
  await storageSet(completeKey(address), true);
}

export async function readSetupDismissed(address: string): Promise<boolean> {
  return (await storageGet(dismissedKey(address))) === true;
}

export async function writeSetupDismissed(
  address: string,
  dismissed: boolean
): Promise<void> {
  await storageSet(dismissedKey(address), dismissed);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @knoww/extension exec vitest run tests/content/setup-flow-storage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + checkpoint (no commit)**

Run: `pnpm --filter @knoww/extension run typecheck`
Expected: no errors. Leave changes uncommitted.

---

## Task 3: Side panel data — load `hasApproval`

**Files:**
- Modify: `apps/extension/src/sidepanel.ts` (the `PortfolioData` type ~line 145, `resolvePortfolioWallet`, and `loadPortfolio` ~line 3128 where `PortfolioData` is assembled)

**Interfaces:**
- Consumes: `isApprovalSufficientForSetup` from `./content/trading/setup-flow`.
- Produces: `PortfolioData.hasApproval: boolean` consumed by Task 5.

**Context:** `loadPortfolio` already resolves the wallet (`{ address, walletMode, isDeployed }`) and computes `hasTradingWallet` via `hasDeployedTradingWallet`. We add an allowance read using the same `trading:get-allowance` message the content side uses (`ownerAddress` = the resolved proxy address, both negRisk legs), and set `hasApproval` when either leg is positive. Allowance is only meaningful once the vault is deployed; skip the RPC otherwise.

- [ ] **Step 1: Add `hasApproval` to the `PortfolioData` type**

Find the `PortfolioData` type (the block added in the working tree containing `hasTradingWallet` and `hasTradingCredentials`). Add the field:

```ts
  hasTradingWallet: boolean;
  hasTradingCredentials: boolean;
  hasApproval: boolean; // on-chain USDC allowance > 0 for the trading wallet
```

- [ ] **Step 2: Import the helper**

Add to the existing `./content/trading/setup-gates` / setup imports block near the top of `sidepanel.ts`:

```ts
import { isApprovalSufficientForSetup } from "./content/trading/setup-flow";
```

- [ ] **Step 3: Read allowance in `loadPortfolio` and assemble `hasApproval`**

In `loadPortfolio`, immediately after `hasTradingWallet` is computed (the `const hasTradingWallet = hasDeployedTradingWallet({...})` added in the working tree) and before the `return { address, ownerAddress, ... }` object, insert:

```ts
  let hasApproval = false;
  if (hasTradingWallet) {
    try {
      const [allow, allowNegRisk] = await Promise.all([
        sendRuntimeMessage({
          type: "trading:get-allowance",
          ownerAddress: wallet.address,
          negRisk: false,
        }),
        sendRuntimeMessage({
          type: "trading:get-allowance",
          ownerAddress: wallet.address,
          negRisk: true,
        }),
      ]);
      const a = (allow.data as { allowance?: number } | undefined)?.allowance ?? 0;
      const b =
        (allowNegRisk.data as { allowance?: number } | undefined)?.allowance ?? 0;
      hasApproval =
        isApprovalSufficientForSetup(a) || isApprovalSufficientForSetup(b);
    } catch {
      hasApproval = false; // non-critical; treat as not-approved
    }
  }
```

Then add `hasApproval,` to the returned `PortfolioData` object literal.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @knoww/extension run typecheck`
Expected: no errors (every `PortfolioData` construction now requires `hasApproval`; this is the only construction site — if the compiler flags another, add `hasApproval: false` there).

- [ ] **Step 5: Run the full extension test suite + checkpoint (no commit)**

Run: `pnpm --filter @knoww/extension run test:scoring`
Expected: PASS (no regressions). Leave changes uncommitted.

---

## Task 4: Side panel setup view (`portfolio-setup-view.ts`)

**Files:**
- Create: `apps/extension/src/content/trading/portfolio-setup-view.ts`
- Test: `apps/extension/tests/content/portfolio-setup-view.test.ts`

**Interfaces:**
- Consumes: `SetupFlow`, `SetupStep`, `SETUP_APPROVAL_DEFAULT` from `./setup-flow`.
- Produces (all return HTML strings; no chrome/DOM):
  - `function renderSetupWizard(args: { flow: SetupFlow; ownerAddress: string; error: string | null; walletPicker: string }): string`
  - `function renderSetupBanner(flow: SetupFlow): string`
  - `function setupProgressRail(flow: SetupFlow): string`

**Notes:** `escapeHtml` is defined in `sidepanel.ts`; this module is pure and must not depend on it. Inputs here are trusted (numbers, fixed labels, an `ownerAddress` hex string). Do not interpolate untrusted strings. The per-step action control is chosen by `flow.currentStepId`. Data attributes drive the side panel's existing delegated click handler (wired in Task 5).

- [ ] **Step 1: Write the failing test**

Create `apps/extension/tests/content/portfolio-setup-view.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "vitest";

import { deriveSetupFlow, type SetupFlowState } from "../../src/content/trading/setup-flow";
import {
  renderSetupBanner,
  renderSetupWizard,
} from "../../src/content/trading/portfolio-setup-view";

const OWNER = "0x0000000000000000000000000000000000000001";

function stateAt(overrides: Partial<SetupFlowState>): SetupFlowState {
  return {
    hasSession: true,
    address: OWNER,
    proxyAddress: "0x0000000000000000000000000000000000000002",
    walletMode: "deposit",
    isDeployed: true,
    hasApproval: true,
    hasCredentials: true,
    cashBalance: 5,
    ...overrides,
  };
}

test("wizard shows the approve control with the default cap on the approve step", () => {
  const flow = deriveSetupFlow(stateAt({ hasApproval: false }));
  const html = renderSetupWizard({ flow, ownerAddress: OWNER, error: null, walletPicker: "" });
  assert.match(html, /data-setup-approve/);
  assert.match(html, /value="100"/);
  assert.doesNotMatch(html, /data-deploy-portfolio-trading-wallet/);
});

test("wizard injects the wallet picker on the connect step", () => {
  const flow = deriveSetupFlow(stateAt({ hasSession: false, address: null }));
  const html = renderSetupWizard({
    flow,
    ownerAddress: OWNER,
    error: null,
    walletPicker: "<div id='picker-sentinel'></div>",
  });
  assert.match(html, /picker-sentinel/);
});

test("wizard surfaces a step error", () => {
  const flow = deriveSetupFlow(stateAt({ isDeployed: false, hasApproval: false, hasCredentials: false }));
  const html = renderSetupWizard({ flow, ownerAddress: OWNER, error: "Boom", error: "Boom", walletPicker: "" } as never);
  assert.match(html, /Boom/);
});

test("banner shows the current step number out of total and a resume hook", () => {
  const flow = deriveSetupFlow(stateAt({ cashBalance: 0 }));
  const html = renderSetupBanner(flow);
  assert.match(html, /data-resume-setup/);
  assert.match(html, /5 of 5|step 5/i);
});
```

> Note: the third test intentionally passes `error` once — fix it to a single `error: "Boom"` when implementing (duplicate key is a typo guard; collapse to one).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @knoww/extension exec vitest run tests/content/portfolio-setup-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/extension/src/content/trading/portfolio-setup-view.ts`:

```ts
import {
  SETUP_APPROVAL_DEFAULT,
  type SetupFlow,
  type SetupStep,
} from "./setup-flow";

function railNode(step: SetupStep): string {
  const mark =
    step.status === "done"
      ? "✓"
      : String(step.index);
  return `<span class="knoww-pf-setup-node is-${step.status}" aria-hidden="true">${mark}</span>`;
}

export function setupProgressRail(flow: SetupFlow): string {
  const nodes = flow.steps.map(railNode).join(
    `<span class="knoww-pf-setup-rail-line" aria-hidden="true"></span>`
  );
  const current = flow.currentIndex;
  return `
    <div class="knoww-pf-setup-rail" role="status"
         aria-label="Setup step ${current} of ${flow.totalSteps}">
      ${nodes}
    </div>
  `;
}

function actionControl(
  flow: SetupFlow,
  ownerAddress: string,
  walletPicker: string
): string {
  switch (flow.currentStepId) {
    case "connect":
      return walletPicker;
    case "vault":
      return `
        <button type="button" class="knoww-portfolio-open primary"
          data-deploy-portfolio-trading-wallet
          data-owner-address="${ownerAddress}">Create vault</button>`;
    case "approve":
      return `
        <div class="knoww-pf-setup-approve">
          <label class="knoww-pf-setup-approve-label">
            Approval limit
            <span class="knoww-pf-setup-approve-field">
              <input type="number" min="1" step="1" inputmode="decimal"
                class="knoww-pf-setup-approve-input"
                data-setup-approve-input value="${SETUP_APPROVAL_DEFAULT}" />
              <span class="knoww-pf-setup-approve-unit">USDC</span>
            </span>
          </label>
          <button type="button" class="knoww-portfolio-open primary"
            data-setup-approve
            data-owner-address="${ownerAddress}">Approve</button>
        </div>`;
    case "credentials":
      return `
        <button type="button" class="knoww-portfolio-open primary"
          data-enable-portfolio-trading
          data-owner-address="${ownerAddress}">Generate API keys</button>`;
    case "funds":
      return `
        <button type="button" class="knoww-portfolio-open primary"
          data-setup-add-funds
          data-owner-address="${ownerAddress}">Add funds</button>`;
    default:
      return "";
  }
}

export function renderSetupWizard(args: {
  flow: SetupFlow;
  ownerAddress: string;
  error: string | null;
  walletPicker: string;
}): string {
  const { flow, ownerAddress, error, walletPicker } = args;
  const current = flow.steps.find((s) => s.id === flow.currentStepId);
  const list = flow.steps
    .map(
      (s) => `
      <li class="knoww-pf-setup-step is-${s.status}">
        <span class="knoww-pf-setup-step-index">${
          s.status === "done" ? "✓" : s.index
        }</span>
        <span class="knoww-pf-setup-step-label">${s.label}</span>
      </li>`
    )
    .join("");

  return `
    <div class="knoww-pf-setup" data-portfolio-setup>
      <div class="knoww-pf-setup-head">
        <span class="knoww-pf-setup-kicker">Set up trading · step ${
          flow.currentIndex
        } of ${flow.totalSteps}</span>
        <button type="button" class="knoww-pf-setup-skip" data-dismiss-setup>
          Skip for now
        </button>
      </div>
      ${setupProgressRail(flow)}
      <div class="knoww-pf-setup-active">
        <strong class="knoww-pf-setup-active-title">${
          current ? current.label : "All set"
        }</strong>
        <span class="knoww-pf-setup-active-helper">${
          current ? current.helper : ""
        }</span>
        ${error ? `<div class="knoww-pf-setup-error">${error}</div>` : ""}
        <div class="knoww-pf-setup-action">
          ${actionControl(flow, ownerAddress, walletPicker)}
        </div>
      </div>
      <ol class="knoww-pf-setup-list">${list}</ol>
    </div>
  `;
}

export function renderSetupBanner(flow: SetupFlow): string {
  return `
    <button type="button" class="knoww-pf-setup-banner" data-resume-setup>
      <span class="knoww-pf-setup-banner-text">
        Finish setting up trading · step ${flow.currentIndex} of ${flow.totalSteps}
      </span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
    </button>
  `;
}
```

- [ ] **Step 4: Fix the test typo and run to verify it passes**

In the test file, collapse the duplicated `error` key in the third test to a single `error: "Boom"` and drop the `as never` cast. Then run:

Run: `pnpm --filter @knoww/extension exec vitest run tests/content/portfolio-setup-view.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + checkpoint (no commit)**

Run: `pnpm --filter @knoww/extension run typecheck`
Expected: no errors. Leave changes uncommitted.

---

## Task 5: Side panel wiring — render modes, approve handler, dismiss/resume, persistence

**Files:**
- Modify: `apps/extension/src/sidepanel.ts` — module state, `renderPortfolioContent`, signed-out path, the delegated click handler (~line 5567 where `data-deploy-portfolio-trading-wallet` is handled), and `loadPortfolio` completion persistence.

**Interfaces:**
- Consumes: `deriveSetupFlow`, `resolveSetupSurfaceMode`, `SetupFlowState` from `./content/trading/setup-flow`; `renderSetupWizard`, `renderSetupBanner` from `./content/trading/portfolio-setup-view`; `readSetupDismissed`, `writeSetupDismissed`, `readSetupComplete`, `markSetupComplete` from `./content/trading/setup-flow-storage`; `PortfolioData.hasApproval` from Task 3.
- Produces: `async function approvePortfolioTrading(ownerAddress: string, approvalAmount: string): Promise<void>`.

**Context:** Today `renderPortfolioContent` calls `renderPortfolioTradingGate(data)` between fund actions and the table. We replace that with mode-based rendering. Module-level setup flags mirror the existing `portfolioTradingError` pattern. Persistence reads are async, so we resolve them in `loadPortfolio` and stash plain booleans the synchronous renderers read.

- [ ] **Step 1: Add imports + module state**

Add imports near the other setup imports:

```ts
import {
  deriveSetupFlow,
  resolveSetupSurfaceMode,
  type SetupFlowState,
} from "./content/trading/setup-flow";
import {
  renderSetupBanner,
  renderSetupWizard,
} from "./content/trading/portfolio-setup-view";
import {
  markSetupComplete,
  readSetupComplete,
  readSetupDismissed,
  writeSetupDismissed,
} from "./content/trading/setup-flow-storage";
```

Add module state near `let portfolioTradingError`:

```ts
let portfolioSetupDismissed = false;
let portfolioSetupComplete = false;
```

- [ ] **Step 2: Build a `SetupFlowState` + replace the gate render**

Add a helper above `renderPortfolioContent`:

```ts
function portfolioSetupState(data: PortfolioData): SetupFlowState {
  return {
    hasSession: true, // PortfolioData only exists once a session is resolved
    address: data.ownerAddress,
    proxyAddress: data.address,
    walletMode: data.walletMode,
    isDeployed: data.hasTradingWallet ? true : false,
    hasApproval: data.hasApproval,
    hasCredentials: data.hasTradingCredentials,
    cashBalance: data.cashBalance,
  };
}

function renderPortfolioSetupSurface(data: PortfolioData): string {
  const flow = deriveSetupFlow(portfolioSetupState(data));
  const mode = resolveSetupSurfaceMode({
    flow,
    persistedComplete: portfolioSetupComplete,
    dismissed: portfolioSetupDismissed,
  });
  if (mode === "complete") return "";
  if (mode === "banner") return renderSetupBanner(flow);
  return renderSetupWizard({
    flow,
    ownerAddress: data.ownerAddress,
    error: portfolioTradingError,
    walletPicker: "", // signed-in wizard never lands on the connect step
  });
}
```

In `renderPortfolioContent`, replace the `${renderPortfolioTradingGate(data)}` line with `${renderPortfolioSetupSurface(data)}`. Below it, gate the fund actions + table so they are hidden while the wizard is expanded but shown for the banner/complete modes:

```ts
  const setupSurface = renderPortfolioSetupSurface(data);
  const wizardExpanded =
    setupSurface !== "" && setupSurface.includes("data-portfolio-setup");
  return `
    ${options.stale ? renderPortfolioStaleNotice() : ""}
    ${renderPortfolioSummary(data)}
    ${wizardExpanded ? "" : renderPortfolioFundActions()}
    ${setupSurface}
    ${wizardExpanded ? "" : renderPortfolioTable(data)}
  `;
```

Delete the now-unused `renderPortfolioTradingGate` function.

- [ ] **Step 3: Resolve persistence flags + mark completion in `loadPortfolio`**

In `loadPortfolio`, after `PortfolioData` is built (the object you added `hasApproval` to in Task 3) and before it is rendered, add:

```ts
  portfolioSetupDismissed = await readSetupDismissed(data.ownerAddress);
  portfolioSetupComplete = await readSetupComplete(data.ownerAddress);
  if (!portfolioSetupComplete) {
    const flow = deriveSetupFlow(portfolioSetupState(data));
    if (flow.isComplete) {
      await markSetupComplete(data.ownerAddress);
      portfolioSetupComplete = true;
    }
  }
```

- [ ] **Step 4: Add the approve handler**

Add next to `deployPortfolioTradingWallet`:

```ts
async function approvePortfolioTrading(
  ownerAddress: string,
  approvalAmount: string
): Promise<void> {
  const container = root?.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  if (container) {
    container.innerHTML = `
      <div class="knoww-portfolio-loading">Approve the permissions signature...</div>
    `;
  }

  const walletMode = await readStoredWalletMode(ownerAddress);
  const response = await sendRuntimeMessage({
    type: "trading:relayer-approve",
    address: ownerAddress,
    walletMode,
    approvalAmount,
  });

  if (response.ok === false) {
    portfolioLoaded = false;
    portfolioTradingError =
      response.error || "Failed to approve trading permissions.";
    if (container) await loadPortfolio(true);
    return;
  }

  portfolioTradingError = null;
  portfolioLoaded = false;
  await loadPortfolio(true);
}
```

- [ ] **Step 5: Wire the new data attributes into the delegated click handler**

Locate the click handler block that currently handles `data-deploy-portfolio-trading-wallet` (~line 5567). Add sibling branches:

```ts
    const setupApprove = (e.target as HTMLElement)?.closest<HTMLElement>(
      "[data-setup-approve]"
    );
    if (setupApprove) {
      const ownerAddress = setupApprove.dataset.ownerAddress;
      const input = root?.querySelector<HTMLInputElement>(
        "[data-setup-approve-input]"
      );
      const amount = (input?.value || "").trim() || "100";
      if (ownerAddress) void approvePortfolioTrading(ownerAddress, amount);
      return;
    }

    const setupFunds = (e.target as HTMLElement)?.closest<HTMLElement>(
      "[data-setup-add-funds]"
    );
    if (setupFunds) {
      setDepositStep("method");
      return;
    }

    const dismissSetup = (e.target as HTMLElement)?.closest<HTMLElement>(
      "[data-dismiss-setup]"
    );
    if (dismissSetup) {
      const owner = portfolioOwnerAddress(); // see note below
      portfolioSetupDismissed = true;
      if (owner) void writeSetupDismissed(owner, true);
      renderPortfolioContent_inPlace();
      return;
    }

    const resumeSetup = (e.target as HTMLElement)?.closest<HTMLElement>(
      "[data-resume-setup]"
    );
    if (resumeSetup) {
      const owner = portfolioOwnerAddress();
      portfolioSetupDismissed = false;
      if (owner) void writeSetupDismissed(owner, false);
      renderPortfolioContent_inPlace();
      return;
    }
```

The existing `data-deploy-portfolio-trading-wallet` and `data-enable-portfolio-trading` handlers already call `deployPortfolioTradingWallet` / `enablePortfolioTrading`; the wizard reuses those exact attributes, so no new wiring is needed for the vault and credentials steps.

For `portfolioOwnerAddress()`: if a helper that returns the current owner address already exists, use it. Otherwise add a tiny accessor that returns the last-loaded `PortfolioData.ownerAddress` (store it in a module variable `let portfolioOwnerAddressValue: string | null` set in `loadPortfolio`, and return it). `renderPortfolioContent_inPlace` already exists (line 1078) and re-renders from the cached data — confirm it re-runs `renderPortfolioContent`; if it caches `PortfolioData`, the dismiss/resume re-render will reflect the new flag.

- [ ] **Step 6: Make the signed-out screen step 1 of the wizard**

In the signed-out render path (`renderPortfolioSignedOut`, used at ~lines 1909/1924/2058 and the initial signed-out render), wrap the existing wallet-choices markup as the connect step's body. Implement by changing `renderPortfolioSignedOut` to return the wizard shell with a synthetic flow:

```ts
function renderPortfolioSignedOut(): string {
  const flow = deriveSetupFlow({
    hasSession: false,
    address: null,
    proxyAddress: null,
    walletMode: "deposit",
    isDeployed: null,
    hasApproval: false,
    hasCredentials: false,
    cashBalance: 0,
  });
  const walletPicker = renderPortfolioWalletChoicesBody(); // existing wallet list + connect/WC markup, extracted
  return renderSetupWizard({
    flow,
    ownerAddress: "",
    error: portfolioConnectError,
    walletPicker,
  });
}
```

Extract today's wallet-choices markup (the inner content of the current `renderPortfolioSignedOut`) into `renderPortfolioWalletChoicesBody()` so it can be injected as the connect step body without behavior change. The existing connect click handlers (`data-connect-portfolio-wallet*`, WalletConnect) keep working because the same markup is reused.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @knoww/extension run typecheck`
Expected: no errors. Resolve any `renderPortfolioTradingGate` references (should be deleted) and confirm `portfolioOwnerAddressValue` is set in `loadPortfolio`.

- [ ] **Step 8: Run full suite + checkpoint (no commit)**

Run: `pnpm --filter @knoww/extension run test:scoring`
Expected: PASS. Leave changes uncommitted.

---

## Task 6: Content card — compact stepped flow (`trading-panel.ts`)

**Files:**
- Modify: `apps/extension/src/content/trading/trading-panel.ts` — the render switch (~5199–5253), replacing the `addDeploySafe` and `addEnableTrading` branches; the two functions at ~1600 and ~1638 are replaced by `addSetupFlow`.

**Interfaces:**
- Consumes: `deriveSetupFlow`, `isApprovalSufficientForSetup`, `SETUP_APPROVAL_DEFAULT`, `type SetupFlow` from `./setup-flow`; existing `TradingService.deployWallet`, `TradingService.approveUsdc`, `TradingService.deriveCredentials`; the card's existing `el` / `elHtml` DOM helpers and deposit view (`activeView === "deposit"`).
- Produces: `function addSetupFlow(panel: HTMLElement, ctx: TradingContext, opts: { errorMessage: string | null }): void`.

**Context:** The card builds a `SetupFlowState` from `ctx` inline (no separate mapper to avoid an import cycle). Approve uses `TradingService.approveUsdc(false, amount)`. Funds switches the card to its existing deposit view. The order-time "Approve pUSD" path is NOT touched. The wallet-mode selector (`addWalletModeSelector`) moves onto the vault step.

- [ ] **Step 1: Import the shared model**

Add to the `./setup-flow` consumers at the top of `trading-panel.ts`:

```ts
import {
  deriveSetupFlow,
  isApprovalSufficientForSetup,
  SETUP_APPROVAL_DEFAULT,
  type SetupFlow,
} from "./setup-flow";
```

- [ ] **Step 2: Add a pure `cardSetupFlow(ctx)` + a unit test for the mapping**

Create a small exported helper so the ctx→flow mapping is testable without DOM. Add to `trading-panel.ts`:

```ts
export function cardSetupFlow(ctx: TradingContext): SetupFlow {
  return deriveSetupFlow({
    hasSession: Boolean(ctx.address),
    address: ctx.address,
    proxyAddress: ctx.proxyAddress,
    walletMode: ctx.walletMode,
    isDeployed: ctx.isDeployed,
    hasApproval:
      isApprovalSufficientForSetup(ctx.usdcAllowance) ||
      isApprovalSufficientForSetup(ctx.usdcAllowanceNegRisk),
    hasCredentials: ctx.hasCredentials,
    cashBalance: ctx.balance,
  });
}
```

Create `apps/extension/tests/content/card-setup-flow.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "vitest";

import { cardSetupFlow } from "../../src/content/trading/trading-panel";

const base = {
  state: "ready",
  address: "0x0000000000000000000000000000000000000001",
  proxyAddress: "0x0000000000000000000000000000000000000002",
  walletMode: "deposit",
  legacySafeAvailable: false,
  isDeployed: true,
  pusdBalance: 0,
  usdcEBalance: 0,
  balance: 10,
  polBalance: 0,
  tokenBalances: [],
  hasCredentials: true,
  error: null,
  orderBook: null,
  orderBookError: null,
  minOrderSize: 0,
  tickSize: 0,
  usdcAllowance: 100,
  usdcAllowanceNegRisk: 100,
} as const;

test("card maps a deployed, approved, credentialed, funded ctx to complete", () => {
  const flow = cardSetupFlow({ ...base });
  assert.equal(flow.isComplete, true);
});

test("card maps an undeployed ctx to the vault step", () => {
  const flow = cardSetupFlow({ ...base, isDeployed: false });
  assert.equal(flow.currentStepId, "vault");
});

test("card maps zero allowance to the approve step", () => {
  const flow = cardSetupFlow({ ...base, usdcAllowance: 0, usdcAllowanceNegRisk: 0 });
  assert.equal(flow.currentStepId, "approve");
});
```

> If importing `trading-panel.ts` in a node test fails because the module touches `document`/`window` at import time, move `cardSetupFlow` (and only it) into `setup-flow.ts` and import `TradingContext` as a `type` there; update this test's import path accordingly. Verify with Step 4.

- [ ] **Step 3: Replace the two gate render branches with `addSetupFlow`**

In the render switch (~5199–5253), replace the `addDeploySafe(...)` branch (the `else if (ctx.isDeployed === false && ctx.proxyAddress)` block) AND the `addEnableTrading(...)` branch (`else if (!ctx.hasCredentials)`) with a single guard that renders the stepped flow whenever setup is incomplete:

```ts
  } else if (!cardSetupFlow(ctx).isComplete && activeView !== "deposit") {
    addSetupFlow(panel, ctx, { errorMessage: state === "error" ? error : null });
    if (state !== "error") {
      return;
    }
  } else if (activeView === "deposit") {
    renderDepositForm(panel, ctx);
```

Keep the earlier transient branches (`deploying`, `deriving-credentials`, the `isDeployed === null` loading spinner) exactly as they are — they sit above this branch and short-circuit. Then implement `addSetupFlow`, replacing `addDeploySafe`/`addEnableTrading`:

```ts
function addSetupFlow(
  p: HTMLElement,
  ctx: TradingContext,
  options: { errorMessage: string | null }
): void {
  const flow = cardSetupFlow(ctx);
  const errorMessage = options.errorMessage
    ? formatTradingPanelErrorMessage(options.errorMessage)
    : null;

  const s = el("div", "knoww-tp-setup");

  // Compact progress rail.
  const rail = el("div", "knoww-tp-setup-rail");
  for (const step of flow.steps) {
    const node = el(
      "span",
      `knoww-tp-setup-node is-${step.status}`,
      step.status === "done" ? "✓" : String(step.index)
    );
    rail.appendChild(node);
  }
  s.appendChild(rail);

  const current = flow.steps.find((step) => step.id === flow.currentStepId);
  s.appendChild(
    el(
      "div",
      "knoww-tp-setup-kicker",
      `Set up trading · step ${flow.currentIndex} of ${flow.totalSteps}`
    )
  );
  if (current) {
    s.appendChild(el("div", "knoww-tp-setup-title", current.label));
    s.appendChild(el("div", "knoww-tp-setup-helper", current.helper));
  }
  if (errorMessage) {
    s.appendChild(el("div", "knoww-tp-enable-error", errorMessage));
  }

  switch (flow.currentStepId) {
    case "vault": {
      addWalletModeSelector(s, ctx);
      const btn = el("button", "knoww-tp-btn-enable", "Create vault");
      btn.onclick = (e) => {
        e.stopPropagation();
        setButtonLoading(btn, "Waiting for signature…");
        TradingService.deployWallet().catch(() => {});
      };
      s.appendChild(btn);
      break;
    }
    case "approve": {
      const row = el("div", "knoww-tp-setup-approve");
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.step = "1";
      input.value = SETUP_APPROVAL_DEFAULT;
      input.className = "knoww-tp-setup-approve-input";
      row.appendChild(input);
      const btn = el("button", "knoww-tp-btn-enable", "Approve");
      btn.onclick = (e) => {
        e.stopPropagation();
        const amount = Number((input.value || "").trim());
        setButtonLoading(btn, "Waiting for signature…");
        TradingService.approveUsdc(
          false,
          Number.isFinite(amount) && amount > 0 ? amount : 100
        ).catch(() => {});
      };
      row.appendChild(btn);
      s.appendChild(row);
      break;
    }
    case "credentials": {
      const btn = el("button", "knoww-tp-btn-enable", "Generate API keys");
      btn.onclick = (e) => {
        e.stopPropagation();
        setButtonLoading(btn, "Waiting for signature…");
        TradingService.deriveCredentials();
      };
      s.appendChild(btn);
      break;
    }
    case "funds": {
      const btn = el("button", "knoww-tp-btn-enable", "Add funds");
      btn.onclick = (e) => {
        e.stopPropagation();
        setActiveView("deposit"); // existing helper that sets activeView + re-renders
      };
      s.appendChild(btn);
      break;
    }
    default:
      break;
  }

  p.appendChild(s);
}
```

Confirm the existing helper that switches the card to the deposit view: if it is named differently than `setActiveView("deposit")`, use the existing name (search for `activeView = "deposit"` assignments). Delete the now-unused `addDeploySafe` and `addEnableTrading` functions.

- [ ] **Step 4: Run the card mapping test**

Run: `pnpm --filter @knoww/extension exec vitest run tests/content/card-setup-flow.test.ts`
Expected: PASS (3 tests). If the import-at-module-load issue described in Step 2's note occurs, apply the fallback (move `cardSetupFlow` into `setup-flow.ts`) and re-run.

- [ ] **Step 5: Typecheck + checkpoint (no commit)**

Run: `pnpm --filter @knoww/extension run typecheck`
Expected: no errors. Confirm the order-time "Approve pUSD" path (`renderOrderForm` / `approveUsdc` at ~2638) is untouched. Leave changes uncommitted.

---

## Task 7: Styles + full verification

**Files:**
- Modify: the extension content/sidepanel stylesheet(s) that define `knoww-pf-*` / `knoww-tp-*` classes (search for an existing class like `knoww-portfolio-trading-gate` to find the file).

**Context:** Add styles for the new classes used in Tasks 4 and 6: `knoww-pf-setup`, `knoww-pf-setup-head`, `knoww-pf-setup-kicker`, `knoww-pf-setup-skip`, `knoww-pf-setup-rail`, `knoww-pf-setup-node` (with `is-done`/`is-now`/`is-pending`), `knoww-pf-setup-rail-line`, `knoww-pf-setup-active*`, `knoww-pf-setup-approve*`, `knoww-pf-setup-error`, `knoww-pf-setup-list`, `knoww-pf-setup-step`, `knoww-pf-setup-banner*`, and the card equivalents `knoww-tp-setup*`. Reuse existing color tokens/spacing from neighboring rules. **No italics** — these are functional UI.

- [ ] **Step 1: Find the stylesheet**

Run: `grep -rn "knoww-portfolio-trading-gate\|knoww-tp-btn-enable" apps/extension/src --include=*.css -l`
Open the file(s) returned; add the new rules adjacent to the existing gate/enable rules, matching their token usage (background, border, radius, font-family). Mark step nodes: `is-done` = filled/green check, `is-now` = outlined/accent, `is-pending` = muted.

- [ ] **Step 2: Typecheck + full test suite**

Run: `pnpm --filter @knoww/extension run typecheck`
Run: `pnpm --filter @knoww/extension run test:scoring`
Expected: both PASS.

- [ ] **Step 3: Build the extension**

Run: `pnpm --filter @knoww/extension run build`
Expected: webpack build succeeds and `assert-production-bundle.mjs` passes.

- [ ] **Step 4: Manual verification checklist**

Load the unpacked `apps/extension/dist` in Chrome and verify, for a brand-new wallet:

- Side panel → Portfolio (signed out): the wizard shell renders with step 1 (Connect) active and the wallet picker inside it; rail shows `1` active, `2–5` pending.
- After connect: step 1 → ✓, step 2 (Create vault) active; Deposit/Withdraw + table hidden while expanded.
- "Skip for now" collapses to the `Finish setting up trading · step N of 5` banner; Deposit/Withdraw + table reappear; reloading the side panel keeps the banner (dismissed persisted).
- Tapping the banner reopens the wizard at the current step.
- Create vault → ✓; Approve step shows the `100` USDC input + Approve; approving advances to Generate API keys.
- Generate API keys → ✓; Add funds step opens the existing Deposit flow; after a deposit, the wizard disappears and the normal portfolio shows.
- In-page card on a market (same new wallet): the compact stepped flow renders with the rail; each step's button works; once complete the order form shows. With an exhausted allowance after setup, placing an order still shows the inline "Approve pUSD" top-up (unchanged).
- Reload after full setup: neither surface shows the wizard (completion persisted).

- [ ] **Step 5: Checkpoint (no commit)**

Leave all changes uncommitted for the user to review and commit.

---

## Self-Review

**Spec coverage:**
- 5-step guided flow, both surfaces → Tasks 1 (model), 4–5 (side panel), 6 (card). ✓
- Explicit approve step w/ allowance input → Task 4 (side panel control), Task 6 (card control), default `100` from `SETUP_APPROVAL_DEFAULT`. ✓
- Funding as a guided step → `funds` step in Task 1; routing in Task 5 (`setDepositStep`) and Task 6 (deposit view). ✓
- Dismissible + resumable banner, progress remembered → Task 2 (storage), Task 5 (modes + handlers). ✓
- Shared step model / no drift → Task 1 is the single source; both surfaces import it (Tasks 5, 6). ✓
- Deploy-before-credentials preserved → step ordering in Task 1 + `hasDeployedTradingWallet` reuse; test "credentials cannot be current while the vault is undeployed". ✓
- Side panel owns the signed-out connect screen → Task 5 Step 6. ✓
- Card keeps order-time "Approve pUSD" → Task 6 leaves `renderOrderForm`/`approveUsdc` untouched; verified in Task 6 Step 5 and Task 7 Step 4. ✓
- Persisted completion prevents resurrection after allowance/cash depletion → Task 2 + Task 5 Step 3 (`markSetupComplete`). (Refinement beyond spec's live-derived completion; noted and intentional.)
- Editorial (no italics), no `+` on P&L → Global Constraints + Task 7. ✓
- Isolation (new focused files, keep `sidepanel.ts` lean) → `setup-flow.ts`, `setup-flow-storage.ts`, `portfolio-setup-view.ts`. ✓
- Testing (pure model heavily covered) → Tasks 1, 2, 4, 6 unit tests. ✓

**Placeholder scan:** No TBD/TODO. The one deliberate "fix the typo" instruction (Task 4) is explicit and self-contained. Manual-verification steps are concrete checks, not placeholders.

**Type consistency:** `SetupFlowState`, `SetupFlow`, `SetupStep`, `SetupStepId`, `SetupSurfaceMode`, `deriveSetupFlow`, `resolveSetupSurfaceMode`, `isApprovalSufficientForSetup`, `SETUP_APPROVAL_DEFAULT`, `renderSetupWizard`, `renderSetupBanner`, `cardSetupFlow`, `approvePortfolioTrading` are used with identical names/signatures across tasks. `PortfolioData.hasApproval` defined in Task 3 and consumed in Task 5. Data attributes (`data-setup-approve`, `data-setup-approve-input`, `data-setup-add-funds`, `data-dismiss-setup`, `data-resume-setup`, reused `data-deploy-portfolio-trading-wallet` / `data-enable-portfolio-trading`) match between Task 4 markup and Task 5 handlers.
