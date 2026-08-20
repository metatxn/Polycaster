import { createLogger } from "@knoww/logger";
import {
  readTradingApprovalStatus,
  type TradingApprovalStatus,
} from "@knoww/shared-types/approvals";
import type { Address } from "viem";
import { getPublicClient } from "@/lib/rpc";

const log = createLogger("approvals");

export type ApprovalStatus = TradingApprovalStatus;

const pendingApprovalChecks = new Map<string, Promise<ApprovalStatus>>();

/**
 * Backoff between multicall attempts. The check often runs during the
 * page-load RPC burst, where /api/rpc/polygon 429s transiently — a short
 * wait is usually enough for the same read to succeed.
 */
const RETRY_DELAYS_MS = [1000, 2500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStatusWithRetry(
  safeAddress: string,
  approvalAmountRaw?: bigint
): Promise<ApprovalStatus> {
  let lastError: unknown;
  let lastPartial: ApprovalStatus | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      const status = await readTradingApprovalStatus(
        getPublicClient(),
        safeAddress as Address,
        approvalAmountRaw ? { approvalAmountRaw } : undefined
      );
      // allApproved=true is trustworthy even with failed reads (a failed
      // read can only under-report). Only unreliable *negative* verdicts
      // are worth retrying.
      if (status.allReadsOk || status.allApproved) return status;
      lastPartial = status;
      log.warn("approvals.partial_read", {
        attempt,
        readFailures: status.readFailures,
      });
    } catch (err) {
      lastError = err;
      log.warn("approvals.read_failed", { attempt, error: err });
    }
  }

  // Out of retries: a partial status still tells callers WHICH reads failed
  // (allReadsOk=false), so they can treat it as unknown instead of missing.
  if (lastPartial) return lastPartial;
  throw lastError;
}

export async function checkAllApprovals(
  safeAddress: string,
  approvalAmountRaw?: bigint
): Promise<ApprovalStatus> {
  const cacheKey = `${safeAddress.toLowerCase()}:${
    approvalAmountRaw?.toString() ?? "default"
  }`;
  const pending = pendingApprovalChecks.get(cacheKey);
  if (pending) return pending;

  const check = readStatusWithRetry(safeAddress, approvalAmountRaw).finally(
    () => {
      pendingApprovalChecks.delete(cacheKey);
    }
  );

  pendingApprovalChecks.set(cacheKey, check);
  return check;
}

export async function needsApprovals(safeAddress: string): Promise<boolean> {
  const status = await checkAllApprovals(safeAddress);
  return !status.allApproved;
}
