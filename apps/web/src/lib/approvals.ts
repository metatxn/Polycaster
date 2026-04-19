import { erc20Abi } from "viem";
import { CONTRACTS } from "@/constants/contracts";
import { getPublicClient } from "@/lib/rpc";

const ERC1155_ABI = [
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    name: "isApprovedForAll",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const APPROVAL_THRESHOLD = BigInt(1_000_000_000_000); // 1M tokens (6 decimals)

export interface ApprovalStatus {
  // pUSD approvals (V2 trading collateral)
  pusdCtfExchange: boolean;
  pusdNegRiskExchange: boolean;
  pusdNegRiskAdapter: boolean;
  // USDC.e approval to Onramp (for wrap)
  usdcOnramp: boolean;
  // ERC-1155 outcome token approvals (unchanged)
  ctfExchangeApproval: boolean;
  ctfNegRiskExchangeApproval: boolean;
  ctfNegRiskAdapterApproval: boolean;
  allApproved: boolean;
}

let lastApprovalCheck = 0;
const MIN_APPROVAL_CHECK_INTERVAL = 200;

async function throttleApprovalCheck(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastApprovalCheck;
  if (elapsed < MIN_APPROVAL_CHECK_INTERVAL) {
    await new Promise((r) =>
      setTimeout(r, MIN_APPROVAL_CHECK_INTERVAL - elapsed)
    );
  }
  lastApprovalCheck = Date.now();
}

async function checkErc20Allowance(
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`
): Promise<boolean> {
  try {
    await throttleApprovalCheck();
    const client = getPublicClient();
    const allowance = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    });
    return allowance >= APPROVAL_THRESHOLD;
  } catch (err) {
    console.error("[Approvals] Failed to check ERC-20 allowance:", err);
    return false;
  }
}

async function checkErc1155Approval(
  owner: `0x${string}`,
  operator: `0x${string}`
): Promise<boolean> {
  try {
    await throttleApprovalCheck();
    const client = getPublicClient();
    return await client.readContract({
      address: CONTRACTS.CTF,
      abi: ERC1155_ABI,
      functionName: "isApprovedForAll",
      args: [owner, operator],
    });
  } catch (err) {
    console.error("[Approvals] Failed to check ERC-1155 approval:", err);
    return false;
  }
}

export async function checkAllApprovals(
  safeAddress: string
): Promise<ApprovalStatus> {
  const owner = safeAddress as `0x${string}`;

  const [
    pusdCtfExchange,
    pusdNegRiskExchange,
    pusdNegRiskAdapter,
    usdcOnramp,
    ctfExchangeApproval,
    ctfNegRiskExchangeApproval,
    ctfNegRiskAdapterApproval,
  ] = await Promise.all([
    checkErc20Allowance(CONTRACTS.PUSD, owner, CONTRACTS.CTF_EXCHANGE),
    checkErc20Allowance(CONTRACTS.PUSD, owner, CONTRACTS.NEG_RISK_CTF_EXCHANGE),
    checkErc20Allowance(CONTRACTS.PUSD, owner, CONTRACTS.NEG_RISK_ADAPTER),
    checkErc20Allowance(CONTRACTS.USDC_E, owner, CONTRACTS.COLLATERAL_ONRAMP),
    checkErc1155Approval(owner, CONTRACTS.CTF_EXCHANGE),
    checkErc1155Approval(owner, CONTRACTS.NEG_RISK_CTF_EXCHANGE),
    checkErc1155Approval(owner, CONTRACTS.NEG_RISK_ADAPTER),
  ]);

  const allApproved =
    pusdCtfExchange &&
    pusdNegRiskExchange &&
    pusdNegRiskAdapter &&
    usdcOnramp &&
    ctfExchangeApproval &&
    ctfNegRiskExchangeApproval &&
    ctfNegRiskAdapterApproval;

  return {
    pusdCtfExchange,
    pusdNegRiskExchange,
    pusdNegRiskAdapter,
    usdcOnramp,
    ctfExchangeApproval,
    ctfNegRiskExchangeApproval,
    ctfNegRiskAdapterApproval,
    allApproved,
  };
}

export async function needsApprovals(safeAddress: string): Promise<boolean> {
  const status = await checkAllApprovals(safeAddress);
  return !status.allApproved;
}
