import { createLogger } from "@knoww/logger";
import { erc20Abi } from "viem";
import { CONTRACTS } from "@/constants/contracts";
import { getPublicClient } from "@/lib/rpc";

const log = createLogger("approvals");

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

const APPROVAL_THRESHOLD = BigInt(1); // User-selected finite allowances are valid.

export interface ApprovalStatus {
  // pUSD direct CTF approval (split/merge/redeem collateral)
  pusdCtf: boolean;
  // pUSD approvals (V2 trading collateral)
  pusdCtfExchange: boolean;
  pusdNegRiskExchange: boolean;
  pusdNegRiskAdapter: boolean;
  pusdCtfCollateralAdapter: boolean;
  pusdNegRiskCtfCollateralAdapter: boolean;
  // USDC.e approval to Onramp (for wrap)
  usdcOnramp: boolean;
  // ERC-1155 outcome token approvals (unchanged)
  ctfExchangeApproval: boolean;
  ctfNegRiskExchangeApproval: boolean;
  ctfNegRiskAdapterApproval: boolean;
  ctfCollateralAdapterApproval: boolean;
  ctfNegRiskCollateralAdapterApproval: boolean;
  allApproved: boolean;
}

export async function checkAllApprovals(
  safeAddress: string
): Promise<ApprovalStatus> {
  const owner = safeAddress as `0x${string}`;
  const client = getPublicClient();

  // Batches all 8 reads into a single Multicall3 aggregate3 call, so we make
  // one RPC round-trip instead of eight. `allowFailure: true` ensures one
  // reverting sub-call can't take down the whole probe — failures show up as
  // `{ status: "failure" }` and we treat them as not-approved.
  const results = await client.multicall({
    allowFailure: true,
    contracts: [
      {
        address: CONTRACTS.PUSD,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, CONTRACTS.CTF],
      },
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
        address: CONTRACTS.PUSD,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, CONTRACTS.CTF_COLLATERAL_ADAPTER],
      },
      {
        address: CONTRACTS.PUSD,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, CONTRACTS.NEG_RISK_CTF_COLLATERAL_ADAPTER],
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
      {
        address: CONTRACTS.CTF,
        abi: ERC1155_ABI,
        functionName: "isApprovedForAll",
        args: [owner, CONTRACTS.CTF_COLLATERAL_ADAPTER],
      },
      {
        address: CONTRACTS.CTF,
        abi: ERC1155_ABI,
        functionName: "isApprovedForAll",
        args: [owner, CONTRACTS.NEG_RISK_CTF_COLLATERAL_ADAPTER],
      },
    ],
  });

  const allowanceOk = (i: number): boolean => {
    const r = results[i];
    if (r.status !== "success") {
      log.error("allowance.read_failed", { error: r.error });
      return false;
    }
    return (r.result as bigint) >= APPROVAL_THRESHOLD;
  };

  const approvalOk = (i: number): boolean => {
    const r = results[i];
    if (r.status !== "success") {
      log.error("approval_for_all.read_failed", { error: r.error });
      return false;
    }
    return r.result as boolean;
  };

  const pusdCtf = allowanceOk(0);
  const pusdCtfExchange = allowanceOk(1);
  const pusdNegRiskExchange = allowanceOk(2);
  const pusdNegRiskAdapter = allowanceOk(3);
  const pusdCtfCollateralAdapter = allowanceOk(4);
  const pusdNegRiskCtfCollateralAdapter = allowanceOk(5);
  const usdcOnramp = allowanceOk(6);
  const ctfExchangeApproval = approvalOk(7);
  const ctfNegRiskExchangeApproval = approvalOk(8);
  const ctfNegRiskAdapterApproval = approvalOk(9);
  const ctfCollateralAdapterApproval = approvalOk(10);
  const ctfNegRiskCollateralAdapterApproval = approvalOk(11);

  const allApproved =
    pusdCtfExchange &&
    pusdNegRiskExchange &&
    pusdNegRiskAdapter &&
    pusdCtfCollateralAdapter &&
    pusdNegRiskCtfCollateralAdapter &&
    usdcOnramp &&
    ctfExchangeApproval &&
    ctfNegRiskExchangeApproval &&
    ctfNegRiskAdapterApproval &&
    ctfCollateralAdapterApproval &&
    ctfNegRiskCollateralAdapterApproval;

  return {
    pusdCtf,
    pusdCtfExchange,
    pusdNegRiskExchange,
    pusdNegRiskAdapter,
    pusdCtfCollateralAdapter,
    pusdNegRiskCtfCollateralAdapter,
    usdcOnramp,
    ctfExchangeApproval,
    ctfNegRiskExchangeApproval,
    ctfNegRiskAdapterApproval,
    ctfCollateralAdapterApproval,
    ctfNegRiskCollateralAdapterApproval,
    allApproved,
  };
}

export async function needsApprovals(safeAddress: string): Promise<boolean> {
  const status = await checkAllApprovals(safeAddress);
  return !status.allApproved;
}
