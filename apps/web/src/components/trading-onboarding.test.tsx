import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { qk } from "@/lib/query-keys";
import { TradingOnboarding } from "./trading-onboarding";

const wagmiState = vi.hoisted(() => ({
  isConnected: true,
}));

const tradingWalletModeState = vi.hoisted(() => ({
  mode: "deposit" as const,
  setMode: vi.fn(),
  hasLegacySafe: false,
  isCheckingLegacySafe: false,
}));

const relayerState = vi.hoisted(() => ({
  approveUsdcForTrading: vi.fn(),
  deploySafe: vi.fn(),
  isLoading: false,
  proxyAddress: "0x0000000000000000000000000000000000000002" as string | null,
  hasDeployedSafe: true,
}));

const credentialsState = vi.hoisted(() => ({
  deriveCredentials: vi.fn(),
  hasCredentials: false,
  isLoading: false,
}));

const proxyWalletState = vi.hoisted(() => ({
  isDeployed: true,
  forceRefresh: vi.fn(),
  proxyAddress: "0x0000000000000000000000000000000000000002" as string | null,
  walletMode: "deposit" as const,
  usdcBalance: 5,
}));

vi.mock("@knoww/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("wagmi", () => ({
  useConnection: () => ({
    isConnected: wagmiState.isConnected,
  }),
}));

vi.mock("@/hooks/use-trading-wallet-mode", () => ({
  useTradingWalletMode: () => tradingWalletModeState,
}));

vi.mock("@/hooks/use-relayer-client", () => ({
  useRelayerClient: () => relayerState,
}));

vi.mock("@/hooks/use-clob-credentials", () => ({
  useClobCredentials: () => credentialsState,
}));

vi.mock("@/hooks/use-proxy-wallet", () => ({
  useProxyWallet: () => proxyWalletState,
}));

const approvalsState = vi.hoisted(() => ({
  checkAllApprovals: vi.fn(),
}));

vi.mock("@/lib/approvals", () => ({
  checkAllApprovals: approvalsState.checkAllApprovals,
}));

vi.mock("@/lib/wallet-modal", () => ({
  openWalletModalStrict: vi.fn(async () => undefined),
}));

describe("TradingOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wagmiState.isConnected = true;
    tradingWalletModeState.mode = "deposit";
    tradingWalletModeState.hasLegacySafe = false;
    tradingWalletModeState.isCheckingLegacySafe = false;
    relayerState.isLoading = false;
    relayerState.proxyAddress = "0x0000000000000000000000000000000000000002";
    relayerState.hasDeployedSafe = true;
    relayerState.approveUsdcForTrading.mockResolvedValue({ success: true });
    // A clean negative: every read succeeded, approvals genuinely missing.
    // Individual tests override this to exercise the unreliable-read path.
    approvalsState.checkAllApprovals.mockResolvedValue({
      allApproved: false,
      allReadsOk: true,
      readFailures: [],
    });
    credentialsState.hasCredentials = false;
    credentialsState.isLoading = false;
    proxyWalletState.isDeployed = true;
    proxyWalletState.proxyAddress =
      "0x0000000000000000000000000000000000000002";
    proxyWalletState.walletMode = "deposit";
    proxyWalletState.usdcBalance = 5;
  });

  it("invalidates trading approval caches after onboarding approval succeeds", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <TradingOnboarding />
      </QueryClientProvider>
    );

    const approveButton = await screen.findByRole("button", {
      name: /approve/i,
    });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(relayerState.approveUsdcForTrading).toHaveBeenCalledWith("5");
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: qk.wallet.allTradingApprovals(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: qk.wallet.allUsdcAllowances(),
      });
    });
  });

  it("commits a clean negative verdict from a single check", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TradingOnboarding />
      </QueryClientProvider>
    );

    // The approve step must still onboard a genuinely-unapproved user:
    // one reliable check, no retries.
    await screen.findByRole("button", { name: /approve/i });
    await waitFor(() => {
      expect(approvalsState.checkAllApprovals).toHaveBeenCalledTimes(1);
    });

    // The deploy effect re-runs after isCheckingApproval settles; a committed
    // verdict (hasUsdcApproval !== null) must not trigger another check.
    await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
    expect(approvalsState.checkAllApprovals).toHaveBeenCalledTimes(1);
  });

  it("degrades to not-approved after capped unreliable checks", async () => {
    approvalsState.checkAllApprovals.mockResolvedValue({
      allApproved: false,
      allReadsOk: false,
      readFailures: ["pusdCtfExchange"],
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TradingOnboarding />
      </QueryClientProvider>
    );

    // Unreliable reads leave the verdict null, so the deploy effect retries
    // exactly once more before the cap degrades the step to pending.
    await waitFor(() => {
      expect(approvalsState.checkAllApprovals).toHaveBeenCalledTimes(2);
    });

    const approveButton = await screen.findByRole("button", {
      name: /approve/i,
    });
    expect(approveButton).toBeEnabled();

    // Capped: the degraded verdict must stop the check loop.
    await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
    expect(approvalsState.checkAllApprovals).toHaveBeenCalledTimes(2);
  });

  it("blocks vault deployment while legacy Safe detection is pending", async () => {
    tradingWalletModeState.isCheckingLegacySafe = true;
    relayerState.hasDeployedSafe = false;
    relayerState.proxyAddress = null;
    proxyWalletState.isDeployed = false;
    proxyWalletState.proxyAddress = null;

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TradingOnboarding />
      </QueryClientProvider>
    );

    const deployButton = await screen.findByRole("button", {
      name: /checking wallet/i,
    });

    expect(deployButton).toBeDisabled();
    fireEvent.click(deployButton);
    expect(relayerState.deploySafe).not.toHaveBeenCalled();
  });
});
