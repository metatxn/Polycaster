export const ONBOARDING_VERSION = 1;
export const ONBOARDING_STORAGE_KEY = "knoww_extension_onboarding_v1";
export const ONBOARDING_DEMO_STATE_KEY = "knoww_onboarding_demo_v1";
export const ONBOARDING_DEMO_URL = "https://x.com/polymarket";
export const ONBOARDING_WALLET_SETUP_PRODUCTION_URL =
  "https://knoww.app/extension/connect";
export const ONBOARDING_WALLET_SETUP_DEVELOPMENT_URL =
  "http://localhost:8000/extension/connect";
export const ONBOARDING_METAMASK_INSTALL_URL =
  "https://chromewebstore.google.com/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn";

export type OnboardingStage = "welcome" | "wallet" | "trading" | "ready";
export type WalletCheckResult = "connected" | "not_connected";

export interface OnboardingProgress {
  startedAt?: string;
  welcomeCompletedAt?: string;
  walletCheckResult?: WalletCheckResult;
  walletInstallClickedAt?: string;
  tradingStartedAt?: string;
  completedAt?: string;
}

interface ResolveOnboardingStageInput {
  welcomeCompleted: boolean;
  loggedIn: boolean;
  hasCredentials: boolean;
  storeBuild: boolean;
}

function readIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

export function isOnboardingWalletSetupUrl(value: string): boolean {
  try {
    const candidate = new URL(value);
    return [
      ONBOARDING_WALLET_SETUP_PRODUCTION_URL,
      ONBOARDING_WALLET_SETUP_DEVELOPMENT_URL,
    ].some((value) => {
      const setupUrl = new URL(value);
      return (
        candidate.origin === setupUrl.origin &&
        candidate.pathname === setupUrl.pathname &&
        candidate.search === setupUrl.search
      );
    });
  } catch {
    return false;
  }
}

export function parseOnboardingProgress(value: unknown): OnboardingProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const stored = value as Record<string, unknown>;
  const walletCheckResult =
    stored.walletCheckResult === "connected" ||
    stored.walletCheckResult === "not_connected"
      ? stored.walletCheckResult
      : undefined;

  return {
    ...(readIsoDate(stored.startedAt)
      ? { startedAt: readIsoDate(stored.startedAt) }
      : {}),
    ...(readIsoDate(stored.welcomeCompletedAt)
      ? { welcomeCompletedAt: readIsoDate(stored.welcomeCompletedAt) }
      : {}),
    ...(walletCheckResult ? { walletCheckResult } : {}),
    ...(readIsoDate(stored.walletInstallClickedAt)
      ? { walletInstallClickedAt: readIsoDate(stored.walletInstallClickedAt) }
      : {}),
    ...(readIsoDate(stored.tradingStartedAt)
      ? { tradingStartedAt: readIsoDate(stored.tradingStartedAt) }
      : {}),
    ...(readIsoDate(stored.completedAt)
      ? { completedAt: readIsoDate(stored.completedAt) }
      : {}),
  };
}

export function resolveOnboardingStage({
  welcomeCompleted,
  loggedIn,
  hasCredentials,
  storeBuild,
}: ResolveOnboardingStageInput): OnboardingStage {
  if (!welcomeCompleted) return "welcome";
  if (!loggedIn) return "wallet";
  if (!storeBuild && !hasCredentials) return "trading";
  return "ready";
}
