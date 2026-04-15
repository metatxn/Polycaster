import { initBridgeSigner } from "../background/signing-state";
import { handleTradingMessage } from "../background/trading-handler";
import type { BackgroundResponse } from "../types/chrome-messages";

let tradingReady = false;

function ensureTradingReady(): void {
  if (tradingReady) return;
  initBridgeSigner();
  tradingReady = true;
}

export async function prewarmTrading(): Promise<void> {
  ensureTradingReady();
}

export async function handleTradingOffscreenMessage(
  payload: { type: string; [key: string]: unknown },
  tabId: number | undefined
): Promise<BackgroundResponse> {
  ensureTradingReady();

  const fakeSender: chrome.runtime.MessageSender = {
    tab: tabId != null ? ({ id: tabId } as chrome.tabs.Tab) : undefined,
  };

  return (
    (await handleTradingMessage(payload, fakeSender)) ?? {
      ok: false,
      error: "Unhandled trading message",
    }
  );
}
