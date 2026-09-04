import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { qk } from "@/lib/query-keys";
import { TradingOnboarding } from "./trading-onboarding";

const wagmiState = vi.hoisted(() => ({
  address: "0x0000000000000000000000000000000000000001",
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

const posthogMock = vi.hoisted(() => ({
  capture: vi.fn(),
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
    address: wagmiState.address,
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

vi.mock("@/lib/approvals", () => ({
  checkAllApprovals: vi.fn().mockResolvedValue({ allApproved: false }),
}));

vi.mock("@/lib/wallet-modal", () => ({
  openWalletModalStrict: vi.fn(async () => undefined),
}));

vi.mock("posthog-js", () => ({
  default: posthogMock,
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
    expect(posthogMock.capture).toHaveBeenCalledWith(
      "trading_token_approval_succeeded",
      {
        product: "web",
        surface: "onboarding",
        wallet_address: "0x0000000000000000000000000000000000000001",
        wallet_mode: "deposit",
      }
    );
  });

  it("tracks a newly deployed trading account", async () => {
    relayerState.hasDeployedSafe = false;
    relayerState.proxyAddress = null;
    proxyWalletState.isDeployed = false;
    proxyWalletState.proxyAddress = null;
    relayerState.deploySafe.mockResolvedValue({ success: true });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TradingOnboarding />
      </QueryClientProvider>
    );

    const deployButton = await screen.findByRole("button", {
      name: /sign/i,
    });
    fireEvent.click(deployButton);

    await waitFor(() => {
      expect(posthogMock.capture).toHaveBeenCalledWith(
        "trading_account_created",
        {
          product: "web",
          surface: "onboarding",
          wallet_address: "0x0000000000000000000000000000000000000001",
          wallet_mode: "deposit",
        }
      );
    });
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
