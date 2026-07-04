import assert from "node:assert/strict";
import { test } from "vitest";
import {
  renderSetupBanner,
  renderSetupFocused,
  renderSetupWizard,
} from "../../src/content/trading/portfolio-setup-view";
import {
  deriveSetupFlow,
  type SetupFlowState,
} from "../../src/content/trading/setup-flow";

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
  const html = renderSetupWizard({
    flow,
    ownerAddress: OWNER,
    error: null,
    walletPicker: "",
  });
  assert.match(html, /data-setup-approve/);
  assert.match(html, /value="100"/);
  assert.doesNotMatch(html, /data-deploy-portfolio-trading-wallet/);
});

test("wizard escapes owner address attributes", () => {
  const flow = deriveSetupFlow(stateAt({ hasApproval: false }));
  const html = renderSetupWizard({
    flow,
    ownerAddress: `0xabc" autofocus data-leak="1`,
    error: null,
    walletPicker: "",
  });

  assert.match(
    html,
    /data-owner-address="0xabc&quot; autofocus data-leak=&quot;1"/
  );
  assert.doesNotMatch(html, /data-owner-address="0xabc" autofocus/);
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
  const flow = deriveSetupFlow(
    stateAt({ isDeployed: false, hasApproval: false, hasCredentials: false })
  );
  const html = renderSetupWizard({
    flow,
    ownerAddress: OWNER,
    error: "Boom",
    walletPicker: "",
  });
  assert.match(html, /Boom/);
});

test("banner shows the current step number out of total and a resume hook", () => {
  const flow = deriveSetupFlow(stateAt({ hasCredentials: false }));
  const html = renderSetupBanner(flow);
  assert.match(html, /data-resume-setup/);
  assert.match(html, /4 of 4|step 4/i);
});

test("wizard no longer renders the redundant numeric rail", () => {
  const flow = deriveSetupFlow(stateAt({ hasApproval: false }));
  const html = renderSetupWizard({
    flow,
    ownerAddress: OWNER,
    error: null,
    walletPicker: "",
  });
  assert.doesNotMatch(html, /knoww-pf-setup-rail/);
});

test("returning-user focused prompt shows only the current action, keeps portfolio visible", () => {
  // Vault deployed + approved, but no CLOB credentials yet (typical old user).
  const flow = deriveSetupFlow(stateAt({ hasCredentials: false }));
  const html = renderSetupFocused({ flow, ownerAddress: OWNER, error: null });
  assert.match(html, /data-enable-portfolio-trading/); // "Generate API keys"
  // No wizard marker => the portfolio table/funds stay visible behind it.
  assert.doesNotMatch(html, /data-portfolio-setup/);
  // No multi-step checklist chrome.
  assert.doesNotMatch(html, /knoww-pf-setup-list/);
});
