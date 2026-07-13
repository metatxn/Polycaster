import type { Market } from "../../types/market";
import type { StreamBetHydrateArgs } from "../trading-runtime-types";
import {
  buildKalshiUrl,
  type MultiOutcomeItem,
  parseMultiOutcomeData,
  resolveMarketDisplayData,
} from "./cards";
import {
  canSellHolding,
  clampStake,
  formatHoldingLine,
  parseStreamStakeInput,
  pickHolding,
  resolvePrimarySportsMoneyline,
  type StreamHolding,
  sellButtonLabel,
  stepStake,
} from "./stream-bet-calc";

export interface StreamTradingContext {
  address?: string | null;
  minOrderSize: number;
  balance: number;
  hasCredentials: boolean;
  state: string;
  usdcAllowance: number;
  usdcAllowanceNegRisk: number;
}

export interface StreamOrderTokens {
  tokenId?: string;
  conditionId?: string;
  negRisk: boolean;
}

export interface StreamOption {
  name: string;
  price: number;
  outcomeIndex: number;
  isMulti: boolean;
  marketIndex: number;
  cls: string;
}

export interface StreamTradingPort {
  getContext(): StreamTradingContext;
  refreshBalance(): Promise<unknown>;
  resolveOrderTokens(
    market: Market,
    outcomeIndex: number,
    isMulti: boolean,
    marketIndex: number
  ): Promise<StreamOrderTokens>;
  placeBuy(market: Market, option: StreamOption, stake: number): Promise<void>;
  placeSell(request: {
    side: "SELL";
    market: Market;
    option: StreamOption;
    shares: number;
  }): Promise<void>;
  getOutcomeBalances(
    yesTokenId: string,
    noTokenId: string
  ): Promise<{ yesBalance: string; noBalance: string }>;
  mountInlineDeposit(args: {
    host: HTMLElement;
    opts: {
      market: Market;
      outcomeName: string;
      outcomeIndex: number;
      price: number;
      side: "BUY";
      tokenId: string;
      anchorElement: HTMLElement;
      isMultiOutcome: boolean;
      initialAmountUsd: number;
      streamDeposit: true;
    };
    onClose(): void;
  }): void;
  closeInlineDeposit(host: HTMLElement): void;
  ensureReady(): Promise<unknown>;
  isDeploymentRequired(): boolean;
  isNegRisk(market: Market, marketIndex: number): boolean;
  approveUsdc(negRisk: boolean): Promise<unknown>;
  openSetupSidePanel(showToast: (message: string) => void): void;
  onStateChange(callback: () => void): () => void;
}

let streamTradingPort: StreamTradingPort | null = null;

export function configureStreamTradingPort(port: StreamTradingPort): void {
  streamTradingPort = port;
}

export function resetStreamTradingPort(): void {
  streamTradingPort = null;
}

function trading(): StreamTradingPort {
  if (!streamTradingPort) {
    throw new Error("Stream trading port is not configured");
  }
  return streamTradingPort;
}

function truncateStreamError(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

let streamStakeUsd: number | null = null;
const streamBetDisposers = new WeakMap<HTMLElement, () => void>();

function getStreamTradingSettings(): {
  defaultAmount: number;
  oneClickEnabled: boolean;
  confirmBeforeTrade: boolean;
} {
  return (
    window.KNOWW_CONFIG?.getStreamTradingSettings?.() || {
      defaultAmount: 20,
      oneClickEnabled: true,
      confirmBeforeTrade: true,
    }
  );
}

function getStreamStake(): number {
  if (streamStakeUsd == null) {
    streamStakeUsd = getStreamTradingSettings().defaultAmount;
  }
  return streamStakeUsd;
}

interface StreamBet {
  outcomes: string[];
  prices: number[];
  isMulti: boolean;
  marketIndex: number;
  multiOutcomeData: MultiOutcomeItem[];
}

/**
 * For a sports/esports event with many nested markets (Match Winner, map
 * winners, handicaps, over/unders…), find the "Match Winner" moneyline market
 * and return its two team outcomes + the nested-market index. That's what a
 * bettor wants on the card — "Team A vs Team B" — not a stray over/under.
 */
function getMatchWinnerBet(market: Market): StreamBet | null {
  const primarySportsMoneyline = resolvePrimarySportsMoneyline(market);
  if (!primarySportsMoneyline) return null;
  const primaryMoneylineOptions = primarySportsMoneyline.multiOutcomeData ?? [];

  return {
    outcomes: primarySportsMoneyline.outcomes,
    prices: primarySportsMoneyline.prices,
    isMulti: primaryMoneylineOptions.length > 0,
    marketIndex: primarySportsMoneyline.marketIndex,
    multiOutcomeData: primaryMoneylineOptions,
  };
}

/** Resolve which outcomes to show on a stream card's betting row. */
function resolveStreamBet(market: Market): StreamBet {
  const moneyline = getMatchWinnerBet(market);
  if (moneyline) return moneyline;

  const d = resolveMarketDisplayData(market);
  const firstActiveMarketIndex =
    parseMultiOutcomeData(market).firstActiveMarketIndex;
  return {
    outcomes: d.outcomes,
    prices: d.prices,
    isMulti: d.isMultiOutcome,
    marketIndex: firstActiveMarketIndex,
    multiOutcomeData: d.multiOutcomeData,
  };
}

/**
 * The outcomes to show as quick-bet buttons on a stream card: the two teams /
 * Yes-No for a head-to-head, or the top 4 options (by price) for a multi-
 * outcome market.
 */
function streamOptionsFor(market: Market): StreamOption[] {
  const bet = resolveStreamBet(market);
  if (bet.isMulti && bet.multiOutcomeData.length > 0) {
    return [...bet.multiOutcomeData]
      .sort((a, b) => b.price - a.price)
      .slice(0, 4)
      .map((o, k) => ({
        name: o.name,
        price: o.price,
        outcomeIndex: 0,
        isMulti: true,
        marketIndex: o.marketIndex,
        cls: `option-${(k % 5) + 1}`,
      }));
  }
  const isYesNo =
    bet.outcomes[0]?.toLowerCase() === "yes" &&
    bet.outcomes[1]?.toLowerCase() === "no";
  return bet.outcomes.slice(0, 2).map((name, k) => ({
    name,
    price: bet.prices[k] ?? 0.5,
    outcomeIndex: k,
    isMulti: false,
    marketIndex: bet.marketIndex,
    cls: isYesNo ? (k === 0 ? "yes" : "no") : `option-${k + 1}`,
  }));
}

/** Resolve the CLOB token / condition / negRisk for a market order. */

type StreamTxStatus = "idle" | "placing" | "placed" | "failed";

export function streamShortTitle(market: Market): string {
  const title = market.title || "Market";
  return title.split(/\s[-–—|]\s/)[0].trim() || title;
}

/**
 * Build the card's betting area to match the design's "one-click trading":
 * the outcomes as a SEGMENT SELECTOR + a single contextual ACTION BUTTON that
 * carries every trade state inline (Trade → Confirm → Placing → Placed, plus
 * Connect / Insufficient / Approve). Selecting an outcome never opens a panel;
 * the big panel is only a setup fallback for connect / approve / deposit.
 */
export function buildStreamBetting(
  market: Market,
  ui: StreamBetHydrateArgs["ui"]
): HTMLElement {
  const marketSource = market.source || "polymarket";
  const isKalshi = marketSource === "kalshi";
  const options = streamOptionsFor(market);

  const wrap = document.createElement("div");
  wrap.className = "knoww-stream-bet";
  let disposed = false;

  // Head: just the BUY/SELL toggle (the market title lives in the collapsed
  // pill directly above, so it isn't repeated here). Hidden by default; shown
  // only when there's a sellable position (see renderHead).
  const head = document.createElement("div");
  head.className = "knoww-stream-head knoww-stream-hidden";
  const buysell = document.createElement("div");
  buysell.className = "knoww-stream-buysell";
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

  // Contextual hint (full width, below the action row) so a wrapped hint can
  // never inflate the stepper/trade row height.
  const hintHost = document.createElement("div");
  hintHost.className = "knoww-stream-hint-host";

  // Holdings footer (2-outcome markets only; filled once balances load).
  const holdFooter = document.createElement("div");
  holdFooter.className = "knoww-stream-hold knoww-stream-hidden";

  // Host for the inline deposit flow (unchanged behavior).
  const depositHost = document.createElement("div");
  depositHost.className = "knoww-stream-deposit-host";

  wrap.appendChild(head);
  wrap.appendChild(segRow);
  wrap.appendChild(actionRow);
  wrap.appendChild(hintHost);
  wrap.appendChild(holdFooter);
  wrap.appendChild(depositHost);

  let selectedIdx = 0;
  let side: "BUY" | "SELL" = "BUY";
  let holding: StreamHolding | null = null;
  let txStatus: StreamTxStatus = "idle";
  let depositing = false;
  let lastError: string | null = null;
  let busy: string | null = null;
  let holdingGen = 0;
  // Holdings footer + BUY/SELL apply ONLY to genuine binary (Yes/No) markets:
  // getOutcomeBalances and pickHolding assume a Yes/No token pair. A
  // multi-outcome market reduced to 2 active options gives every option
  // outcomeIndex 0 (distinguished by marketIndex), which would mis-target the
  // sell — so exclude those. They keep BUY + the stepper, no footer/toggle.
  const twoSided =
    options.length === 2 && !options[0].isMulti && !options[1].isMulti;

  const runSetup = (label: string, fn: () => Promise<unknown>): void => {
    busy = label;
    renderAction();
    fn()
      .catch(() => {
        /* leave state; the action re-renders to the current readiness */
      })
      .finally(() => {
        busy = null;
        renderAction();
      });
  };

  // Balance settles asynchronously after a trade/deposit (V2 fill settlement,
  // bridge credit). An immediate refresh reads the pre-change value, so poll a
  // few times until ctx.balance moves off `before` — the card's onStateChange
  // subscription re-renders the action once it lands.
  const pollBalanceChange = (before: number): void => {
    let tries = 0;
    const tick = async (): Promise<void> => {
      await trading().refreshBalance();
      tries += 1;
      if (tries < 6 && trading().getContext().balance === before) {
        window.setTimeout(() => void tick(), 2500);
      }
    };
    void tick();
  };

  const doPlace = (): void => {
    const opt = options[selectedIdx];
    const balanceBefore = trading().getContext().balance;
    txStatus = "placing";
    renderAction();
    trading()
      .placeBuy(market, opt, getStreamStake())
      .then(() => {
        txStatus = "placed";
        lastError = null;
        window.KNOWW_PREFERENCES?.recordClick(market);
        // Reflect the spent collateral once the fill settles on-chain.
        pollBalanceChange(balanceBefore);
      })
      .catch((err: unknown) => {
        txStatus = "failed";
        lastError = err instanceof Error ? err.message : String(err) || null;
        // The balance may be stale (e.g. funds withdrawn elsewhere), which is
        // how an unaffordable trade slipped through. Refresh so the card
        // re-renders to the correct "Deposit to trade" state after the failure.
        void trading().refreshBalance();
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
  };

  function doSell(): void {
    if (!holding) return;
    const opt = options[holding.outcomeIndex];
    const balanceBefore = trading().getContext().balance;
    txStatus = "placing";
    renderAction();
    trading()
      .placeSell({
        side: "SELL",
        market,
        option: opt,
        shares: holding.shares,
      })
      .then(() => {
        txStatus = "placed";
        lastError = null;
        pollBalanceChange(balanceBefore);
        void loadHolding();
      })
      .catch((err: unknown) => {
        txStatus = "failed";
        lastError = err instanceof Error ? err.message : String(err) || null;
        void trading().refreshBalance();
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

  // Open the deposit flow INLINE inside the card: hide the bet controls and let
  // the trading panel's deposit engine render into `depositHost`. Keeps the
  // funding flow on one surface instead of spawning a separate floating panel.
  const openInlineDeposit = (): void => {
    const opt = options[selectedIdx];
    depositing = true;
    ui.setInlineDepositActive(true);
    // Toggle a class (not inline styles) — the bet-control rules use !important,
    // which inline styles can't override.
    wrap.classList.add("depositing");
    // The deposit form is taller than the bet controls, but the stack only
    // enables scrolling via `.knoww-has-overflow` inside updateNotificationStack
    // — which we suppress while depositing. Enable scroll directly so the
    // confirm button is always reachable, and bring the form into view.
    const itemsContainer = document.getElementById("knoww-stack-items");
    itemsContainer?.classList.add("knoww-has-overflow");
    trading().mountInlineDeposit({
      host: depositHost,
      opts: {
        market,
        outcomeName: opt.name,
        outcomeIndex: opt.outcomeIndex,
        price: opt.price,
        side: "BUY",
        tokenId: "",
        anchorElement: wrap,
        isMultiOutcome: opt.isMulti,
        initialAmountUsd: getStreamStake(),
        streamDeposit: true,
      },
      onClose: () => {
        depositing = false;
        ui.setInlineDepositActive(false);
        if (disposed) return;
        wrap.classList.remove("depositing");
        renderSegments();
        renderStepper();
        renderAction();
        // The bridge can report "complete" a beat before the on-chain pUSD
        // balance is readable, so on return the card may still show the old
        // balance. Poll until it changes — the subscription re-renders.
        pollBalanceChange(trading().getContext().balance);
      },
    });
    requestAnimationFrame(() => {
      depositHost.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  function renderSegments(): void {
    segRow.innerHTML = "";
    options.forEach((opt, i) => {
      const seg = document.createElement("button");
      seg.type = "button";
      const sideCls = twoSided ? (i === 0 ? "yes" : "no") : "opt";
      seg.className = `knoww-stream-seg ${sideCls}${
        i === selectedIdx ? " sel" : ""
      }`;
      const cents = Math.round(opt.price * 100);
      const label = document.createElement("span");
      label.className = "knoww-stream-seg-name";
      label.textContent = opt.name;
      const price = document.createElement("span");
      price.className = "knoww-stream-seg-price";
      price.textContent = `${cents}¢`;
      seg.appendChild(label);
      seg.appendChild(price);
      seg.onclick = (e) => {
        e.stopPropagation();
        if (isKalshi) {
          window.open(buildKalshiUrl(market), "_blank", "noopener,noreferrer");
          return;
        }
        selectedIdx = i;
        txStatus = "idle";
        renderSegments();
        renderStepper();
        renderAction();
      };
      segRow.appendChild(seg);
    });
  }

  function renderStepper(): void {
    stepperWrap.innerHTML = "";
    const stake = getStreamStake();
    const normalizedStake = clampStake(stake);
    const setInputWidth = (input: HTMLInputElement): void => {
      input.style.width = `${Math.max(2, input.value.length)}ch`;
    };
    const mk = (label: string, dir: 1 | -1): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "knoww-stream-step-btn";
      b.textContent = label;
      const nextVal = stepStake(stake, dir);
      b.disabled = nextVal === stake;
      b.onclick = (e) => {
        e.stopPropagation();
        streamStakeUsd = stepStake(getStreamStake(), dir);
        txStatus = "idle";
        renderStepper();
        renderAction();
      };
      return b;
    };
    const val = document.createElement("label");
    val.className = "knoww-stream-step-val";
    const dollar = document.createElement("span");
    dollar.className = "knoww-stream-step-prefix";
    dollar.textContent = "$";
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.className = "knoww-stream-step-input";
    input.setAttribute("aria-label", "Trade amount in dollars");
    input.value = String(normalizedStake);
    setInputWidth(input);
    input.onpointerdown = (e) => e.stopPropagation();
    input.onclick = (e) => e.stopPropagation();
    input.onfocus = (e) => {
      e.stopPropagation();
      input.select();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        input.blur();
      } else if (e.key === "Escape") {
        input.value = String(clampStake(getStreamStake()));
        input.blur();
      }
    };
    input.oninput = (e) => {
      e.stopPropagation();
      setInputWidth(input);
      const parsed = parseStreamStakeInput(input.value);
      if (parsed == null) return;
      streamStakeUsd = parsed;
      txStatus = "idle";
      renderAction();
    };
    input.onblur = () => {
      streamStakeUsd =
        parseStreamStakeInput(input.value) ?? clampStake(getStreamStake());
      window.setTimeout(() => {
        if (!wrap.isConnected) return;
        renderStepper();
        renderAction();
      }, 0);
    };
    val.appendChild(dollar);
    val.appendChild(input);
    stepperWrap.appendChild(mk("−", -1));
    stepperWrap.appendChild(val);
    stepperWrap.appendChild(mk("+", 1));
  }

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

  function renderHead(): void {
    buysell.innerHTML = "";
    // The head (BUY/SELL toggle) only appears when there's a sellable position in
    // THIS market — otherwise there's nothing to sell, so we stay BUY-only and
    // hide the head entirely, keeping the card small.
    const ctx = trading().getContext();
    const sellable = twoSided && canSellHolding(holding, ctx.minOrderSize || 0);
    head.classList.toggle("knoww-stream-hidden", !sellable);
    if (!sellable) {
      if (side === "SELL") side = "BUY";
      return;
    }
    (["BUY", "SELL"] as const).forEach((s) => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = `knoww-stream-bs-opt${s === side ? " sel" : ""}`;
      opt.textContent = s;
      opt.disabled = txStatus === "placing";
      opt.onclick = (e) => {
        e.stopPropagation();
        if (txStatus === "placing") return;
        if (side === s) return;
        side = s;
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
      holdFooter.classList.add("knoww-stream-hidden");
      holdFooter.innerHTML = "";
      return;
    }
    holdFooter.classList.remove("knoww-stream-hidden");
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
    const ctx = trading().getContext();
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

  async function loadHolding(): Promise<void> {
    if (!twoSided) return;
    const gen = ++holdingGen;
    try {
      const [yesTok, noTok] = await Promise.all([
        trading().resolveOrderTokens(
          market,
          options[0].outcomeIndex,
          options[0].isMulti,
          options[0].marketIndex
        ),
        trading().resolveOrderTokens(
          market,
          options[1].outcomeIndex,
          options[1].isMulti,
          options[1].marketIndex
        ),
      ]);
      if (gen !== holdingGen || !wrap.isConnected) return;
      if (!yesTok.tokenId || !noTok.tokenId) return;
      const balances = await trading().getOutcomeBalances(
        yesTok.tokenId,
        noTok.tokenId
      );
      if (gen !== holdingGen || !wrap.isConnected) return;
      holding = pickHolding([
        {
          outcomeIndex: options[0].outcomeIndex,
          name: options[0].name,
          balance: balances.yesBalance,
          price: options[0].price,
        },
        {
          outcomeIndex: options[1].outcomeIndex,
          name: options[1].name,
          balance: balances.noBalance,
          price: options[1].price,
        },
      ]);
      if (side === "SELL" && !holding) {
        // The whole position was just sold (or vanished). Fall back to BUY and
        // clear the trade status so the BUY-worded "Trade placed ✓" can't flash
        // after a sell — the SELL "Sold ✓" was already shown by doSell.
        side = "BUY";
        txStatus = "idle";
      }
      // Holding changed → refresh the BUY/SELL toggle visibility (renderHead
      // gates it on a sellable position), the stepper, footer, pill and action.
      renderHead();
      renderStepper();
      renderHold();
      renderPill();
      renderAction();
    } catch {
      /* balances are best-effort; leave the footer hidden */
    }
  }

  function renderAction(): void {
    actionWrap.innerHTML = "";
    hintHost.innerHTML = "";

    const showStepper =
      side === "BUY" &&
      !busy &&
      (txStatus === "idle" || txStatus === "failed" || txStatus === "placed");

    if (side === "SELL") {
      actionRow.classList.add("full");
      stepperWrap.classList.add("knoww-stream-hidden");
      const ctx = trading().getContext();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "knoww-stream-trade rose";
      if (!holding || !canSellHolding(holding, ctx.minOrderSize || 0)) {
        btn.classList.remove("rose");
        btn.classList.add("ghost");
        btn.disabled = true;
        btn.textContent = holding
          ? "Position too small to sell"
          : "Nothing to sell";
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
      } else if (txStatus === "failed") {
        btn.classList.remove("rose");
        btn.classList.add("ghost");
        btn.textContent = "Unable to sell — retry";
        btn.onclick = (e) => {
          e.stopPropagation();
          doSell();
        };
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
    stepperWrap.classList.toggle("knoww-stream-hidden", !showStepper);

    const opt = options[selectedIdx];
    const stake = getStreamStake();
    const ctx = trading().getContext();
    const pct = Math.round(opt.price * 100);
    const sideColor =
      options.length === 2 && selectedIdx === 1 ? "rose" : "green";

    // Busy (inline setup in flight) → spinner, short-circuit everything.
    if (busy) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "knoww-stream-trade ghost";
      b.disabled = true;
      b.innerHTML = `<span class="knoww-stream-spin"></span> ${busy}`;
      actionWrap.appendChild(b);
      return;
    }

    let kind:
      | "ready"
      | "placing"
      | "placed"
      | "failed"
      | "connect"
      | "setup"
      | "enable"
      | "insufficient"
      | "approve"
      | "kalshi";
    if (isKalshi) kind = "kalshi";
    else if (txStatus === "placing") kind = "placing";
    else if (txStatus === "placed") kind = "placed";
    else if (txStatus === "failed") kind = "failed";
    else if (!ctx.address) kind = "connect";
    else if (trading().isDeploymentRequired()) kind = "setup";
    else if (!ctx.hasCredentials || ctx.state !== "ready") kind = "enable";
    else if (stake > ctx.balance) kind = "insufficient";
    else {
      const negRisk = trading().isNegRisk(market, opt.marketIndex);
      const allowance = negRisk ? ctx.usdcAllowanceNegRisk : ctx.usdcAllowance;
      kind = allowance < stake ? "approve" : "ready";
    }

    const hint = document.createElement("div");
    hint.className = "knoww-stream-hint";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "knoww-stream-trade";

    switch (kind) {
      case "kalshi":
        btn.classList.add("ghost");
        btn.textContent = "Trade on Kalshi";
        btn.onclick = (e) => {
          e.stopPropagation();
          window.open(buildKalshiUrl(market), "_blank", "noopener,noreferrer");
        };
        break;
      case "connect":
        btn.classList.add("ghost");
        btn.textContent = "Connect to trade";
        hint.textContent = "Connect a wallet to place trades";
        btn.onclick = (e) => {
          e.stopPropagation();
          // Inline: triggers the wallet's own connect + signature popups.
          runSetup("Connecting…", () => trading().ensureReady());
        };
        break;
      case "setup":
        btn.classList.add("ghost");
        btn.textContent = "Set up trading";
        hint.textContent = "Create your trading wallet in the side panel";
        btn.onclick = (e) => {
          e.stopPropagation();
          trading().openSetupSidePanel(ui.showToast);
        };
        break;
      case "enable":
        btn.classList.add("ghost");
        btn.textContent = "Enable trading";
        hint.textContent = "One-time signature to enable trading";
        btn.onclick = (e) => {
          e.stopPropagation();
          runSetup("Enabling…", () => trading().ensureReady());
        };
        break;
      case "insufficient":
        btn.classList.add("deposit");
        btn.textContent = `Deposit to trade $${stake}`;
        hint.textContent = `Balance $${ctx.balance.toFixed(2)} · add funds to place this trade`;
        btn.onclick = (e) => {
          e.stopPropagation();
          openInlineDeposit();
        };
        break;
      case "approve":
        btn.classList.add("ghost");
        btn.textContent = "Approve to trade";
        hint.textContent = "One-time approval, then trade instantly";
        btn.onclick = (e) => {
          e.stopPropagation();
          const negRisk = trading().isNegRisk(market, opt.marketIndex);
          runSetup("Approving…", () => trading().approveUsdc(negRisk));
        };
        break;
      case "placing":
        btn.classList.add("ghost");
        btn.disabled = true;
        btn.innerHTML = `<span class="knoww-stream-spin"></span> Placing trade…`;
        break;
      case "placed":
        btn.classList.add("green");
        btn.disabled = true;
        btn.textContent = "Trade placed ✓";
        hint.classList.add("good");
        hint.textContent = `Filled · ${opt.name} ${pct}¢`;
        break;
      case "failed":
        btn.classList.add("ghost");
        btn.textContent = "Unable to place — retry";
        hint.classList.add("warn");
        hint.textContent = lastError
          ? truncateStreamError(lastError, 110)
          : "Something went wrong · tap to retry";
        btn.onclick = (e) => {
          e.stopPropagation();
          doPlace();
        };
        break;
      default:
        // ready
        btn.classList.add(sideColor);
        {
          const amount = document.createElement("span");
          amount.textContent = `Trade $${stake}`;
          const sub = document.createElement("span");
          sub.className = "knoww-stream-trade-sub";
          sub.textContent = `${opt.name} · ${pct}¢`;
          btn.append(amount, sub);
        }
        btn.onclick = (e) => {
          e.stopPropagation();
          // Instant one-click placement — no confirm step. The user has already
          // expanded the card and picked an amount, so the trade button is the
          // commit action.
          doPlace();
        };
        break;
    }

    actionWrap.appendChild(btn);
    if (hint.textContent) hintHost.appendChild(hint);
  }

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
  const unsubState = trading().onStateChange(() => {
    if (!wrap.isConnected) {
      disposeStreamBetting(wrap);
      return;
    }
    if (busy || depositing) return;
    renderHead();
    renderStepper();
    renderAction();
    renderHold();
  });

  // Refresh holdings when this card is (re)expanded (see the item click handler).
  const handleExpanded = (): void => {
    void loadHolding();
  };
  const handleCollapsed = (): void => {
    if (depositing) trading().closeInlineDeposit(depositHost);
  };
  wrap.addEventListener("knoww-stream-expanded", handleExpanded);
  wrap.addEventListener("knoww-stream-collapsed", handleCollapsed);

  streamBetDisposers.set(wrap, () => {
    if (disposed) return;
    disposed = true;
    holdingGen += 1;
    unsubState();
    wrap.removeEventListener("knoww-stream-expanded", handleExpanded);
    wrap.removeEventListener("knoww-stream-collapsed", handleCollapsed);
    if (depositing) {
      trading().closeInlineDeposit(depositHost);
      depositing = false;
    }
    ui.setInlineDepositActive(false);
    streamBetDisposers.delete(wrap);
  });

  return wrap;
}

export function disposeStreamBetting(element: HTMLElement): void {
  streamBetDisposers.get(element)?.();
}

/** Place a market SELL of `shares` of the given stream outcome. Throws on failure. */
