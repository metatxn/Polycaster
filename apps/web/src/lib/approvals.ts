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

export async function checkAllApprovals(
  safeAddress: string
): Promise<ApprovalStatus> {
  const owner = safeAddress as `0x${string}`;
  const client = getPublicClient();

  // Batches all 7 reads into a single Multicall3 aggregate3 call, so we make
  // one RPC round-trip instead of seven. `allowFailure: true` ensures one
  // reverting sub-call can't take down the whole probe — failures show up as
  // `{ status: "failure" }` and we treat them as not-approved.
  const results = await client.multicall({
    allowFailure: true,
    contracts: [
      {
        address: CONTRACTS.PUSD,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, CONTRACTS.CTF_EXCHANGE],
      },
      {
        address: CONTRACTS.PUSD,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, CONTRACTS.NEG_RISK_CTF_EXCHANGE],
      },
      {
        address: CONTRACTS.PUSD,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, CONTRACTS.NEG_RISK_ADAPTER],
      },
      {
        address: CONTRACTS.USDC_E,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, CONTRACTS.COLLATERAL_ONRAMP],
      },
      {
        address: CONTRACTS.CTF,
        abi: ERC1155_ABI,
        functionName: "isApprovedForAll",
        args: [owner, CONTRACTS.CTF_EXCHANGE],
      },
      {
        address: CONTRACTS.CTF,
        abi: ERC1155_ABI,
        functionName: "isApprovedForAll",
        args: [owner, CONTRACTS.NEG_RISK_CTF_EXCHANGE],
      },
      {
        address: CONTRACTS.CTF,
        abi: ERC1155_ABI,
        functionName: "isApprovedForAll",
        args: [owner, CONTRACTS.NEG_RISK_ADAPTER],
      },
    ],
  });

  const allowanceOk = (i: number): boolean => {
    const r = results[i];
    if (r.status !== "success") {
      console.error("[Approvals] allowance read failed:", r.error);
      return false;
    }
    return (r.result as bigint) >= APPROVAL_THRESHOLD;
  };

  const approvalOk = (i: number): boolean => {
    const r = results[i];
    if (r.status !== "success") {
      console.error("[Approvals] isApprovedForAll read failed:", r.error);
      return false;
    }
    return r.result as boolean;
  };

  const pusdCtfExchange = allowanceOk(0);
  const pusdNegRiskExchange = allowanceOk(1);
  const pusdNegRiskAdapter = allowanceOk(2);
  const usdcOnramp = allowanceOk(3);
  const ctfExchangeApproval = approvalOk(4);
  const ctfNegRiskExchangeApproval = approvalOk(5);
  const ctfNegRiskAdapterApproval = approvalOk(6);

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
