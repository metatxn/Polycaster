import { sameAddress } from "@knoww/shared-types/bridge";

import { backoffDelayMs } from "./backoff";

export async function resolvePortfolioApprovalPollAddress(args: {
  ownerAddress: string;
  currentProxyAddress: string | null | undefined;
  resolvePortfolioWallet: (
    ownerAddress: string
  ) => Promise<{ address?: string | null; walletMode?: string | null }>;
}): Promise<string | null> {
  if (args.currentProxyAddress) return args.currentProxyAddress;

  let wallet: { address?: string | null; walletMode?: string | null };
  try {
    wallet = await args.resolvePortfolioWallet(args.ownerAddress);
  } catch {
    return null;
  }
  if (wallet.walletMode === "eoa") {
    return wallet.address || args.ownerAddress;
  }
  // Non-EOA: a missing or owner-equal address means the derive failed and the
  // resolver's EOA fallback leaked through (a CREATE2-derived wallet never
  // equals its owner). Polling the owner would read the wrong account and
  // report a completed approval as "not approved" — return null so the
  // caller reports "couldn't verify" instead.
  if (!wallet.address || sameAddress(wallet.address, args.ownerAddress)) {
    return null;
  }
  return wallet.address;
}

export function nextPortfolioApprovalPollDelayMs(attempt: number): number {
  return backoffDelayMs(attempt, { baseMs: 1000, factor: 2, capMs: 8000 });
}

type ResolvedPortfolioWalletDeployment = {
  address?: string | null;
  isDeployed?: boolean | null;
};

function normalizeDelayMs(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export interface PollUntilOptions {
  timeoutMs: number;
  nextDelayMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Poll `check` until it returns a non-null value or the deadline passes;
 * returns null on timeout. Check errors are swallowed (transient read
 * failures keep polling). A synthetic scheduled-delay budget guards against
 * frozen clocks and zero/NaN delays, so fake-timer tests can't spin forever.
 * The one poll loop for portfolio waits — deployment and approval both ride
 * on it instead of hand-rolling deadline/backoff/swallow variants.
 */
export async function pollUntil<T>(
  check: () => Promise<T | null>,
  options: PollUntilOptions
): Promise<T | null> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const nextDelayMs = options.nextDelayMs ?? nextPortfolioApprovalPollDelayMs;
  const timeoutMs = Math.max(0, options.timeoutMs);
  const deadline = now() + timeoutMs;
  let attempt = 0;
  let scheduledDelayElapsedMs = 0;

  while (now() < deadline && scheduledDelayElapsedMs < timeoutMs) {
    try {
      const result = await check();
      if (result !== null) return result;
    } catch {
      // Transient check failure — keep polling until the deadline.
    }

    const delayMs = normalizeDelayMs(nextDelayMs(attempt++));
    await sleep(delayMs);
    scheduledDelayElapsedMs += Math.max(1, delayMs);
  }

  return null;
}

export async function waitForPortfolioTradingWalletDeployment(args: {
  ownerAddress: string;
  expectedProxyAddress?: string | null;
  resolvePortfolioWallet: (
    ownerAddress: string
  ) => Promise<ResolvedPortfolioWalletDeployment>;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  nextDelayMs?: (attempt: number) => number;
  now?: () => number;
}): Promise<boolean> {
  const expectedProxyAddress = args.expectedProxyAddress || null;

  const deployed = await pollUntil(
    async () => {
      const wallet = await args.resolvePortfolioWallet(args.ownerAddress);
      const addressMatches =
        expectedProxyAddress === null ||
        (typeof wallet.address === "string" &&
          sameAddress(wallet.address, expectedProxyAddress));
      return wallet.isDeployed === true && addressMatches ? true : null;
    },
    {
      timeoutMs: args.timeoutMs ?? 90_000,
      nextDelayMs: args.nextDelayMs,
      sleep: args.sleep,
      now: args.now,
    }
  );

  return deployed === true;
}
