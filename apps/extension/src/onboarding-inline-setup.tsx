import * as React from "react";
import { sendRuntimeMessage } from "./sidepanel/messaging";
import {
  createPortfolioSetup,
  SETUP_STYLES,
  type SetupPortfolioData,
} from "./sidepanel/setup";

/** Reuses the extension's setup actions without mounting the portfolio side panel. */
export function InlineSetup({ onProgress }: { onProgress(): Promise<void> }) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const content = root.querySelector<HTMLElement>(
      "[data-sidepanel-portfolio]"
    );
    if (!content) return;
    let disposed = false;
    let loading = false;
    let actionLabel: string | null = null;
    let activeButton: HTMLButtonElement | null = null;
    const disabledBefore = new Map<HTMLButtonElement, boolean>();
    const updateBusy = () => {
      if (disposed) return;
      const busy = loading || actionLabel !== null;
      root.setAttribute("aria-busy", String(busy));
      const status = root.querySelector<HTMLElement>(
        "[data-setup-action-status]"
      );
      if (status) {
        status.setAttribute("aria-hidden", String(!busy));
        const label = status.querySelector("span");
        if (label) label.textContent = actionLabel ?? "Refreshing setup...";
      }
      for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
        if (button.matches("[data-walletconnect-cancel]")) continue;
        if (busy) {
          if (!disabledBefore.has(button))
            disabledBefore.set(button, button.disabled);
          button.disabled = true;
        } else if (disabledBefore.has(button)) {
          button.disabled = disabledBefore.get(button) ?? false;
        }
      }
      activeButton?.setAttribute("aria-busy", String(busy));
      if (!busy) {
        disabledBefore.clear();
        activeButton = null;
      }
    };
    let data: SetupPortfolioData | null = null;
    const render = () => {
      if (disposed) return;
      content.innerHTML = data
        ? setup.renderSurface(data).html
        : setup.renderSignedOut();
      updateBusy();
    };
    const load = async () => {
      if (disposed || loading) return;
      loading = true;
      updateBusy();
      try {
        const response = await sendRuntimeMessage({
          type: "auth:get-session-info",
        });
        if (!response.ok) throw new Error("Session unavailable");
        const session = response.data as
          | { loggedIn?: boolean; address?: string }
          | undefined;
        const address = session?.loggedIn === true ? session.address : null;
        if (!address) {
          data = null;
          await setup.prepareSignedOut();
        } else if (!__STORE_BUILD__) {
          const wallet = await setup.resolveWallet(address);
          const [status, approval] = await Promise.all([
            setup.getTradingStatus(address),
            wallet.isDeployed
              ? setup.hasApproval(wallet.address)
              : Promise.resolve(false),
          ]);
          const next: SetupPortfolioData = {
            address: wallet.address,
            ownerAddress: address,
            walletMode: wallet.walletMode,
            hasTradingWallet: wallet.isDeployed,
            hasTradingCredentials: status.hasCredentials,
            hasApproval: approval === true,
            approvalReadStatus: approval === null ? "degraded" : "complete",
            cashBalance: 0,
          };
          if (
            !disposed &&
            (await setup.reconcileLoadedData(next, () => !disposed))
          )
            data = next;
        }
        render();
        if (!disposed) await onProgress();
      } catch {
        if (!disposed)
          content.textContent =
            "We couldn't load your setup. Select Refresh setup to try again.";
      } finally {
        loading = false;
        updateBusy();
      }
    };
    const setup = createPortfolioSetup({
      analyticsSurface: "extension_onboarding",
      onActionStateChange: (label) => {
        actionLabel = label;
        updateBusy();
      },
      root,
      getPortfolioData: () => data,
      reloadPortfolio: load,
      renderPortfolio: render,
      invalidatePortfolio: () => {},
      resetFunding: () => {},
      openFunding: () => {},
    });
    const click = (event: Event) => {
      if (loading) return;
      const target = event.target as Element | null;
      activeButton = target?.closest<HTMLButtonElement>("button") ?? null;
      if (target?.closest("[data-onboarding-refresh]")) {
        if (!setup.isBusy()) void load();
        return;
      }
      setup.handleClick(event);
    };
    root.addEventListener("click", click);
    const focus = () => {
      if (!setup.isBusy()) void load();
    };
    window.addEventListener("focus", focus);
    void load();
    return () => {
      disposed = true;
      setup.reset();
      root.removeEventListener("click", click);
      window.removeEventListener("focus", focus);
    };
  }, [onProgress]);

  return (
    <div ref={rootRef} className="onboarding-inline-setup">
      <style>{SETUP_STYLES}</style>
      <div
        data-setup-action-status=""
        className="setup-action-status"
        role="status"
        aria-hidden="true"
      >
        <i className="button-spinner" aria-hidden="true" />
        <span />
      </div>
      <div data-sidepanel-portfolio="" aria-live="polite">
        Checking wallets and existing setup...
      </div>
      <button type="button" className="text-action" data-onboarding-refresh="">
        Refresh setup
      </button>
    </div>
  );
}
