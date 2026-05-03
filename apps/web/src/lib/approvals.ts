import {
  readTradingApprovalStatus,
  type TradingApprovalStatus,
} from "@knoww/shared-types/approvals";
import type { Address } from "viem";
import { getPublicClient } from "@/lib/rpc";

export type ApprovalStatus = TradingApprovalStatus;

export async function checkAllApprovals(
  safeAddress: string,
  approvalAmountRaw?: bigint
): Promise<ApprovalStatus> {
  return readTradingApprovalStatus(
    getPublicClient(),
    safeAddress as Address,
    approvalAmountRaw ? { approvalAmountRaw } : undefined
  );
}

export async function needsApprovals(safeAddress: string): Promise<boolean> {
  const status = await checkAllApprovals(safeAddress);
  return !status.allApproved;
}
