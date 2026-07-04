import { escapeHtml } from "../utils";
import { SETUP_APPROVAL_DEFAULT, type SetupFlow } from "./setup-flow";

function actionControl(
  flow: SetupFlow,
  ownerAddress: string,
  walletPicker: string
): string {
  const escapedOwnerAddress = escapeHtml(ownerAddress);
  switch (flow.currentStepId) {
    case "connect":
      return walletPicker;
    case "vault":
      return `
        <button type="button" class="knoww-portfolio-open primary"
          data-deploy-portfolio-trading-wallet
          data-owner-address="${escapedOwnerAddress}">Create vault</button>`;
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
            data-owner-address="${escapedOwnerAddress}">Approve</button>
        </div>`;
    case "credentials":
      return `
        <button type="button" class="knoww-portfolio-open primary"
          data-enable-portfolio-trading
          data-owner-address="${escapedOwnerAddress}">Generate API keys</button>`;
    default:
      return "";
  }
}

// New-user onboarding: a single clean checklist. Each step is one row showing
// its status; only the current step expands to reveal its helper + action.
// (No separate numeric rail — that duplicated the list.)
export function renderSetupWizard(args: {
  flow: SetupFlow;
  ownerAddress: string;
  error: string | null;
  walletPicker: string;
}): string {
  const { flow, ownerAddress, error, walletPicker } = args;
  const list = flow.steps
    .map((s) => {
      const isCurrent = s.id === flow.currentStepId;
      const expansion = isCurrent
        ? `
          <span class="knoww-pf-setup-step-helper">${s.helper}</span>
          ${
            error
              ? `<div class="knoww-pf-setup-error">${escapeHtml(error)}</div>`
              : ""
          }
          <div class="knoww-pf-setup-action">${actionControl(
            flow,
            ownerAddress,
            walletPicker
          )}</div>`
        : "";
      return `
        <li class="knoww-pf-setup-step is-${s.status}">
          <span class="knoww-pf-setup-step-index">${
            s.status === "done" ? "✓" : s.index
          }</span>
          <div class="knoww-pf-setup-step-body">
            <span class="knoww-pf-setup-step-label">${s.label}</span>
            ${expansion}
          </div>
        </li>`;
    })
    .join("");

  return `
    <div class="knoww-pf-setup" data-portfolio-setup>
      <div class="knoww-pf-setup-head">
        <span class="knoww-pf-setup-kicker">Set up trading</span>
        <button type="button" class="knoww-pf-setup-skip" data-dismiss-setup>
          Skip for now
        </button>
      </div>
      <ol class="knoww-pf-setup-list">${list}</ol>
    </div>
  `;
}

// Returning user (trading vault already deployed): a single focused prompt for
// whatever is left — typically generating CLOB API keys. Renders WITHOUT the
// `data-portfolio-setup` marker so the portfolio (positions, funds) stays
// visible behind it.
export function renderSetupFocused(args: {
  flow: SetupFlow;
  ownerAddress: string;
  error: string | null;
}): string {
  const { flow, ownerAddress, error } = args;
  const current = flow.steps.find((s) => s.id === flow.currentStepId);
  if (!current) return "";
  return `
    <div class="knoww-pf-setup-focused">
      <div class="knoww-pf-setup-focused-text">
        <strong>${current.label}</strong>
        <span>${error ? escapeHtml(error) : current.helper}</span>
      </div>
      <div class="knoww-pf-setup-focused-action">
        ${actionControl(flow, ownerAddress, "")}
      </div>
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
