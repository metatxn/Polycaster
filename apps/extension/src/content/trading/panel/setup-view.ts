import { SHOW_EOA_OPTION } from "@knoww/shared-types/polymarket";
import { SETUP_APPROVAL_DEFAULT, type SetupFlow } from "../setup-flow";
import { writeSetupDismissed } from "../setup-flow-storage";
import { type TradingContext, TradingService } from "../trading-service";
import { panelState } from "./panel-state";

export interface SetupViewUiPort {
  el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string
  ): HTMLElementTagNameMap[K];
  buildInlineError(message: string | null | undefined): HTMLElement;
  setButtonLoading(button: HTMLElement, label: string): void;
  rerender(): void;
}

export function addWalletModeSelector(
  parent: HTMLElement,
  ctx: TradingContext,
  ui: SetupViewUiPort
): void {
  const showLegacySafe = ctx.legacySafeAvailable || ctx.walletMode === "safe";
  const modes: Array<{
    mode: TradingContext["walletMode"];
    label: string;
    desc: string;
  }> = [];

  if (showLegacySafe) {
    modes.push({
      mode: "safe",
      label: "Safe",
      desc: "Legacy Polymarket Safe wallet.",
    });
  } else {
    modes.push({
      mode: "deposit",
      label: "Deposit Wallet",
      desc: "New Polymarket wallet for gasless setup and trading.",
    });
  }

  if (SHOW_EOA_OPTION) {
    modes.push({
      mode: "eoa",
      label: "EOA",
      desc: "Trade directly from this wallet. Requires POL for gas.",
    });
  }

  if (modes.length === 1) {
    const onlyMode = modes[0];
    const statusLabel =
      onlyMode.mode === "safe" ? "Safe Wallet" : "Deposit Wallet";
    parent.appendChild(
      ui.el("div", "knoww-tp-wallet-mode-status", `Using ${statusLabel}`)
    );
    return;
  }

  const wrap = ui.el("div", "knoww-tp-wallet-mode");
  wrap.appendChild(
    ui.el("div", "knoww-tp-wallet-mode-title", "Trading wallet")
  );

  const options = ui.el("div", "knoww-tp-wallet-mode-options");
  if (!showLegacySafe) options.classList.add("no-safe");

  for (const item of modes) {
    const button = ui.el(
      "button",
      `knoww-tp-wallet-mode-option${
        ctx.walletMode === item.mode ? " active" : ""
      }`
    );
    button.innerHTML = `<span>${item.label}</span><small>${item.desc}</small>`;
    button.onclick = (event) => {
      event.stopPropagation();
      if (ctx.walletMode === item.mode) return;
      button.classList.add("loading");
      void TradingService.setWalletMode(item.mode).catch(() => {});
    };
    options.appendChild(button);
  }

  wrap.appendChild(options);
  parent.appendChild(wrap);
}

export function addSetupFlow(
  parent: HTMLElement,
  ctx: TradingContext,
  options: { errorMessage: string | null; flow: SetupFlow },
  ui: SetupViewUiPort
): void {
  const flow = options.flow;
  const rawError = options.errorMessage;
  const section = ui.el("div", "knoww-tp-setup");
  const isReturning =
    flow.steps.find((step) => step.id === "vault")?.status === "done";

  if (!isReturning) {
    const rail = ui.el("div", "knoww-tp-setup-rail");
    for (const step of flow.steps) {
      rail.appendChild(
        ui.el(
          "span",
          `knoww-tp-setup-node is-${step.status}`,
          step.status === "done" ? "✓" : String(step.index)
        )
      );
    }
    section.appendChild(rail);
    section.appendChild(
      ui.el(
        "div",
        "knoww-tp-setup-kicker",
        `Set up trading · step ${flow.currentIndex} of ${flow.totalSteps}`
      )
    );
  }

  const current = flow.steps.find((step) => step.id === flow.currentStepId);
  if (current) {
    section.appendChild(ui.el("div", "knoww-tp-setup-title", current.label));
    section.appendChild(ui.el("div", "knoww-tp-setup-helper", current.helper));
  }
  if (rawError) section.appendChild(ui.buildInlineError(rawError));

  switch (flow.currentStepId) {
    case "vault": {
      addWalletModeSelector(section, ctx, ui);
      const button = ui.el("button", "knoww-tp-btn-enable", "Create vault");
      button.onclick = (event) => {
        event.stopPropagation();
        ui.setButtonLoading(button, "Waiting for signature…");
        TradingService.deployWallet().catch(() => {
          // Error flows through ctx.error; the next render surfaces it here.
        });
      };
      section.appendChild(button);
      break;
    }
    case "approve": {
      const row = ui.el("div", "knoww-tp-setup-approve");
      const field = ui.el("div", "knoww-tp-setup-approve-field");
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.step = "1";
      input.value = SETUP_APPROVAL_DEFAULT;
      input.className = "knoww-tp-setup-approve-input";
      field.appendChild(input);
      field.appendChild(ui.el("span", "knoww-tp-setup-approve-unit", "USDC"));
      row.appendChild(field);
      const button = ui.el("button", "knoww-tp-btn-enable", "Approve");
      button.onclick = (event) => {
        event.stopPropagation();
        const amount = Number((input.value || "").trim());
        ui.setButtonLoading(button, "Waiting for signature…");
        TradingService.approveUsdc(
          false,
          Number.isFinite(amount) && amount > 0
            ? amount
            : Number(SETUP_APPROVAL_DEFAULT)
        ).catch(() => {
          // Error flows through ctx.error; the next render surfaces it here.
        });
      };
      row.appendChild(button);
      section.appendChild(row);
      break;
    }
    case "credentials": {
      const button = ui.el(
        "button",
        "knoww-tp-btn-enable",
        "Generate API keys"
      );
      button.onclick = (event) => {
        event.stopPropagation();
        ui.setButtonLoading(button, "Waiting for signature…");
        TradingService.deriveCredentials();
      };
      section.appendChild(button);
      break;
    }
    default:
      break;
  }

  parent.appendChild(section);
}

export function addSetupBanner(
  parent: HTMLElement,
  ctx: TradingContext,
  ui: SetupViewUiPort
): void {
  const section = ui.el("div", "knoww-tp-setup");
  section.appendChild(
    ui.el("div", "knoww-tp-setup-title", "Finish setting up trading")
  );
  section.appendChild(
    ui.el(
      "div",
      "knoww-tp-setup-helper",
      "A couple of quick signatures and you can trade right from this card."
    )
  );
  const button = ui.el("button", "knoww-tp-btn-enable", "Resume setup");
  button.onclick = (event) => {
    event.stopPropagation();
    panelState.cardSetupDismissed = false;
    if (ctx.address) void writeSetupDismissed(ctx.address, false);
    ui.rerender();
  };
  section.appendChild(button);
  parent.appendChild(section);
}
