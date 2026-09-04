import {
  isCtfPusdAmountOverBalance,
  normalizeCtfPusdAmount,
} from "@knoww/shared-types/ctf";
import {
  type LoadingMessageInput,
  startLoadingMessageSequence,
} from "../../../loading-messages";
import {
  balanceToNumber,
  formatBalance,
  hasDisplayPosition,
  positionValueUsd,
} from "../../ui/outcome-balances";
import { type TradingContext, TradingService } from "../trading-service";
import { formatSplitMergeAmount, getExactPusdBalance } from "./format";
import { type PanelOptions, panelState } from "./panel-state";

export interface PositionsViewUiPort {
  el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
    text?: string
  ): HTMLElementTagNameMap[K];
  elHtml<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls: string,
    html: string
  ): HTMLElementTagNameMap[K];
  rerender(): void;
  trackAnalytics(
    event: string,
    properties?: Record<string, string | number | boolean | null | undefined>
  ): void;
  showToast(
    panel: HTMLElement,
    message: string,
    type: "success" | "error"
  ): void;
  icons: { back: string; alert: string };
}

function setPositionActionLoading(
  button: HTMLButtonElement,
  messages: LoadingMessageInput,
  ui: PositionsViewUiPort
): void {
  const spinner = ui.el("span", "knoww-tp-submit-spinner");
  const label = ui.el("span");
  button.replaceChildren(spinner, label);
  startLoadingMessageSequence(label, messages);
  button.disabled = true;
  button.classList.add("loading");
}

export function refreshSplitMergeState(
  opts: PanelOptions,
  ui: PositionsViewUiPort,
  {
    refreshWallet = true,
    refreshOutcomeBalances = false,
    resetOutcomeBalances = false,
  }: {
    refreshWallet?: boolean;
    refreshOutcomeBalances?: boolean;
    resetOutcomeBalances?: boolean;
  } = {}
): void {
  if (refreshWallet) TradingService.refreshBalance().catch(() => {});
  if (!refreshOutcomeBalances || !opts.yesTokenId || !opts.noTokenId) return;

  if (resetOutcomeBalances) {
    panelState.outcomeBalances = null;
    panelState.outcomeBalancesLoaded = false;
    ui.rerender();
  }
  if (panelState.outcomeBalancesFetching) return;

  panelState.outcomeBalancesFetching = true;
  TradingService.getOutcomeBalances(opts.yesTokenId, opts.noTokenId)
    .then((balances) => {
      panelState.outcomeBalances = balances;
      panelState.outcomeBalancesLoaded = true;
    })
    .catch(() => {
      panelState.outcomeBalancesLoaded = true;
    })
    .finally(() => {
      panelState.outcomeBalancesFetching = false;
      ui.rerender();
    });
}

export function getCanonicalSplitMergeAmount(): string | null {
  try {
    return normalizeCtfPusdAmount(panelState.splitMergeAmount);
  } catch {
    return null;
  }
}

export function addPortfolioBar(
  p: HTMLElement,
  _ctx: TradingContext,
  opts: PanelOptions,
  ui: PositionsViewUiPort
): void {
  const yesPos = panelState.outcomeBalances?.yesBalance ?? "0";
  const noPos = panelState.outcomeBalances?.noBalance ?? "0";
  const showYes = hasDisplayPosition(yesPos);
  const showNo = hasDisplayPosition(noPos);
  if (!showYes && !showNo) return;

  const currentYesPrice =
    opts.yesTokenId && opts.noTokenId ? panelState.yesPrice : opts.price;
  const currentNoPrice =
    opts.yesTokenId && opts.noTokenId
      ? panelState.noPriceValue
      : 1 - currentYesPrice;
  const yesLabel = opts.outcomeIndex === 0 ? opts.outcomeName : "Yes";
  const noLabel = opts.outcomeIndex === 0 ? "No" : opts.outcomeName;
  const portfolio = ui.el("div", "knoww-tp-portfolio-bar");

  if (showYes) {
    const row = ui.el("div", "knoww-tp-portfolio-row");
    row.appendChild(ui.el("span", "knoww-tp-portfolio-label", yesLabel));
    row.appendChild(
      ui.el(
        "span",
        "knoww-tp-portfolio-value positive",
        `${formatBalance(yesPos, 1)} @ $${currentYesPrice.toFixed(2)} · $${positionValueUsd(yesPos, currentYesPrice)}`
      )
    );
    portfolio.appendChild(row);
  }
  if (showNo) {
    const row = ui.el("div", "knoww-tp-portfolio-row");
    row.appendChild(ui.el("span", "knoww-tp-portfolio-label", noLabel));
    row.appendChild(
      ui.el(
        "span",
        "knoww-tp-portfolio-value positive",
        `${formatBalance(noPos, 1)} @ $${currentNoPrice.toFixed(2)} · $${positionValueUsd(noPos, currentNoPrice)}`
      )
    );
    portfolio.appendChild(row);
  }
  p.appendChild(portfolio);
}

export function getPositionSize(opts: PanelOptions): number {
  if (!panelState.outcomeBalances) return 0;
  return balanceToNumber(
    opts.outcomeIndex === 0
      ? panelState.outcomeBalances.yesBalance
      : panelState.outcomeBalances.noBalance
  );
}

export function renderSplitForm(
  p: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext,
  ui: PositionsViewUiPort
): void {
  if (!opts.conditionId) {
    p.appendChild(
      ui.el(
        "div",
        "knoww-tp-info-msg",
        "Split is not available for this market."
      )
    );
    return;
  }

  const pusdBalance = getExactPusdBalance(ctx);
  const canonicalAmount = getCanonicalSplitMergeAmount();
  const displayAmount = canonicalAmount
    ? formatSplitMergeAmount(canonicalAmount)
    : null;
  const exceedsBalance = canonicalAmount
    ? isCtfPusdAmountOverBalance(canonicalAmount, pusdBalance)
    : false;
  const form = ui.el("div", "knoww-tp-form");
  const back = ui.elHtml(
    "button",
    "knoww-tp-back-btn",
    `${ui.icons.back} Back to trading`
  );
  back.onclick = (event) => {
    event.stopPropagation();
    panelState.activeView = "order";
    ui.rerender();
  };
  form.appendChild(back);

  const info = ui.el("div", "knoww-tp-info-box");
  info.innerHTML =
    "<strong>Split:</strong> Convert pUSD into equal YES + NO shares.<br>1 pUSD → 1 YES + 1 NO";
  form.appendChild(info);
  const header = ui.el("div", "knoww-tp-section-header");
  header.appendChild(ui.el("span", "knoww-tp-section-label", "Amount (pUSD)"));
  form.appendChild(header);

  const inputRow = ui.el("div", "knoww-tp-input-row");
  const input = document.createElement("input");
  input.className = "knoww-tp-input-field";
  input.type = "text";
  input.inputMode = "decimal";
  input.min = "0.000001";
  input.step = "0.000001";
  input.placeholder = "0.00";
  input.value = panelState.splitMergeAmount;
  input.oninput = () => {
    panelState.splitMergeAmount = input.value;
    ui.rerender();
  };
  const maxBtn = ui.el("button", "knoww-tp-max-btn", "Max");
  maxBtn.onclick = (event) => {
    event.stopPropagation();
    panelState.splitMergeAmount = pusdBalance;
    input.value = pusdBalance;
    ui.rerender();
  };
  inputRow.append(input, maxBtn);
  form.appendChild(inputRow);

  if (canonicalAmount && displayAmount) {
    const summary = ui.el("div", "knoww-tp-summary");
    const spend = ui.el("div", "knoww-tp-summary-row");
    spend.appendChild(ui.el("span", "knoww-tp-summary-label", "You spend"));
    spend.appendChild(
      ui.el("span", "knoww-tp-summary-value", `${displayAmount} pUSD`)
    );
    const receive = ui.el("div", "knoww-tp-summary-row");
    receive.appendChild(ui.el("span", "knoww-tp-summary-label", "You receive"));
    receive.appendChild(
      ui.el(
        "span",
        "knoww-tp-summary-value positive",
        `${displayAmount} YES + ${displayAmount} NO`
      )
    );
    summary.append(spend, receive);
    form.appendChild(summary);
  }

  if (exceedsBalance) {
    const warning = ui.el("div", "knoww-tp-balance-warn");
    const top = ui.el("div", "knoww-tp-warn-top");
    const left = ui.el("div", "knoww-tp-warn-left");
    left.appendChild(ui.elHtml("span", "knoww-tp-warn-icon", ui.icons.alert));
    left.appendChild(
      ui.el("span", "knoww-tp-warn-text", "Insufficient pUSD balance")
    );
    top.appendChild(left);
    warning.appendChild(top);
    form.appendChild(warning);
  }

  const btn = ui.el("button", "knoww-tp-submit split");
  if (ctx.state === "splitting") {
    setPositionActionLoading(
      btn,
      [
        "Splitting your pUSD...",
        "Creating your market shares...",
        "Checking the new balances for you...",
      ],
      ui
    );
  } else if (!canonicalAmount || !displayAmount) {
    btn.textContent = panelState.splitMergeAmount.trim()
      ? "Invalid Amount"
      : "Enter Amount";
    btn.disabled = true;
  } else if (exceedsBalance) {
    btn.textContent = "Insufficient Balance";
    btn.disabled = true;
  } else {
    btn.textContent = `Split ${displayAmount} pUSD`;
  }
  btn.onclick = async (event) => {
    event.stopPropagation();
    if (
      btn.disabled ||
      !canonicalAmount ||
      !opts.conditionId ||
      !panelState.activePanel
    )
      return;
    const panel = panelState.activePanel;
    const properties = {
      product: "extension",
      marketId: opts.market.id,
      marketTitle: opts.market.title || "Untitled Market",
      amount: canonicalAmount,
    };
    try {
      ui.trackAnalytics("position_split_submitted", properties);
      await TradingService.splitPosition(
        opts.conditionId,
        canonicalAmount,
        opts.yesTokenId,
        opts.noTokenId,
        !!opts.negRisk
      );
      ui.trackAnalytics("position_split_succeeded", properties);
      ui.showToast(panel, "Split completed!", "success");
      refreshSplitMergeState(opts, ui, {
        refreshWallet: true,
        refreshOutcomeBalances: true,
      });
    } catch (error) {
      ui.trackAnalytics("position_split_failed", {
        ...properties,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      ui.showToast(
        panel,
        error instanceof Error ? error.message : "Split failed",
        "error"
      );
    }
  };
  form.appendChild(btn);
  p.appendChild(form);
}

export function renderMergeForm(
  p: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext,
  ui: PositionsViewUiPort
): void {
  if (!opts.conditionId || !opts.yesTokenId || !opts.noTokenId) {
    p.appendChild(
      ui.el(
        "div",
        "knoww-tp-info-msg",
        "Merge is not available for this market."
      )
    );
    return;
  }

  const maxMerge = panelState.outcomeBalances?.minBalance ?? "0";
  const canonicalAmount = getCanonicalSplitMergeAmount();
  const displayAmount = canonicalAmount
    ? formatSplitMergeAmount(canonicalAmount)
    : null;
  const exceedsBalance =
    canonicalAmount && panelState.outcomeBalances
      ? isCtfPusdAmountOverBalance(canonicalAmount, maxMerge)
      : false;
  const form = ui.el("div", "knoww-tp-form");
  const back = ui.elHtml(
    "button",
    "knoww-tp-back-btn",
    `${ui.icons.back} Back to trading`
  );
  back.onclick = (event) => {
    event.stopPropagation();
    panelState.activeView = "order";
    ui.rerender();
  };
  form.appendChild(back);
  const info = ui.el("div", "knoww-tp-info-box");
  info.innerHTML =
    "<strong>Merge:</strong> Convert equal YES + NO shares back into pUSD.<br>1 YES + 1 NO → 1 pUSD";
  form.appendChild(info);

  if (panelState.outcomeBalances) {
    const summary = ui.el("div", "knoww-tp-summary");
    for (const [label, value, cls] of [
      [
        "YES balance",
        panelState.outcomeBalances.yesBalance,
        "knoww-tp-summary-value",
      ],
      [
        "NO balance",
        panelState.outcomeBalances.noBalance,
        "knoww-tp-summary-value",
      ],
      [
        "Max merge",
        panelState.outcomeBalances.minBalance,
        "knoww-tp-summary-value positive",
      ],
    ] as const) {
      const row = ui.el("div", "knoww-tp-summary-row");
      row.appendChild(ui.el("span", "knoww-tp-summary-label", label));
      row.appendChild(ui.el("span", cls, formatBalance(value, 2)));
      summary.appendChild(row);
    }
    form.appendChild(summary);
  } else {
    form.appendChild(
      ui.el(
        "div",
        "knoww-tp-info-msg",
        panelState.outcomeBalancesLoaded
          ? "Balances unavailable."
          : "Checking your position..."
      )
    );
  }

  const header = ui.el("div", "knoww-tp-section-header");
  header.appendChild(
    ui.el("span", "knoww-tp-section-label", "Amount to merge")
  );
  form.appendChild(header);
  const inputRow = ui.el("div", "knoww-tp-input-row");
  const input = document.createElement("input");
  input.className = "knoww-tp-input-field";
  input.type = "text";
  input.inputMode = "decimal";
  input.min = "0.000001";
  input.step = "0.000001";
  input.placeholder = "0.00";
  input.value = panelState.splitMergeAmount;
  input.oninput = () => {
    panelState.splitMergeAmount = input.value;
    ui.rerender();
  };
  const maxBtn = ui.el("button", "knoww-tp-max-btn", "Max");
  maxBtn.onclick = (event) => {
    event.stopPropagation();
    panelState.splitMergeAmount = maxMerge;
    input.value = maxMerge;
    ui.rerender();
  };
  inputRow.append(input, maxBtn);
  form.appendChild(inputRow);

  if (canonicalAmount && displayAmount) {
    const preview = ui.el("div", "knoww-tp-summary");
    const spend = ui.el("div", "knoww-tp-summary-row");
    spend.appendChild(ui.el("span", "knoww-tp-summary-label", "You spend"));
    spend.appendChild(
      ui.el(
        "span",
        "knoww-tp-summary-value",
        `${displayAmount} YES + ${displayAmount} NO`
      )
    );
    const receive = ui.el("div", "knoww-tp-summary-row");
    receive.appendChild(ui.el("span", "knoww-tp-summary-label", "You receive"));
    receive.appendChild(
      ui.el("span", "knoww-tp-summary-value positive", `${displayAmount} pUSD`)
    );
    preview.append(spend, receive);
    form.appendChild(preview);
  }

  if (exceedsBalance) {
    const warning = ui.el("div", "knoww-tp-balance-warn");
    const top = ui.el("div", "knoww-tp-warn-top");
    const left = ui.el("div", "knoww-tp-warn-left");
    left.appendChild(ui.elHtml("span", "knoww-tp-warn-icon", ui.icons.alert));
    left.appendChild(
      ui.el("span", "knoww-tp-warn-text", "Amount exceeds available balance")
    );
    top.appendChild(left);
    warning.appendChild(top);
    form.appendChild(warning);
  }

  const btn = ui.el("button", "knoww-tp-submit merge");
  if (ctx.state === "merging") {
    setPositionActionLoading(
      btn,
      [
        "Merging your shares...",
        "Returning pUSD to your balance...",
        "Checking the updated balance for you...",
      ],
      ui
    );
  } else if (!canonicalAmount || !displayAmount) {
    btn.textContent = panelState.splitMergeAmount.trim()
      ? "Invalid Amount"
      : "Enter Amount";
    btn.disabled = true;
  } else if (!panelState.outcomeBalances) {
    btn.textContent = "Checking your position...";
    btn.disabled = true;
  } else if (exceedsBalance) {
    btn.textContent = "Insufficient Shares";
    btn.disabled = true;
  } else {
    btn.textContent = `Merge ${displayAmount} shares`;
  }
  btn.onclick = async (event) => {
    event.stopPropagation();
    if (
      btn.disabled ||
      !canonicalAmount ||
      !opts.conditionId ||
      !panelState.activePanel
    )
      return;
    const panel = panelState.activePanel;
    const properties = {
      product: "extension",
      marketId: opts.market.id,
      marketTitle: opts.market.title || "Untitled Market",
      amount: canonicalAmount,
    };
    try {
      ui.trackAnalytics("position_merge_submitted", properties);
      await TradingService.mergePositions(
        opts.conditionId,
        canonicalAmount,
        opts.yesTokenId,
        opts.noTokenId,
        !!opts.negRisk
      );
      ui.trackAnalytics("position_merge_succeeded", properties);
      ui.showToast(panel, "Merge completed!", "success");
      refreshSplitMergeState(opts, ui, {
        refreshWallet: true,
        refreshOutcomeBalances: true,
      });
    } catch (error) {
      ui.trackAnalytics("position_merge_failed", {
        ...properties,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      ui.showToast(
        panel,
        error instanceof Error ? error.message : "Merge failed",
        "error"
      );
    }
  };
  form.appendChild(btn);
  p.appendChild(form);
}
