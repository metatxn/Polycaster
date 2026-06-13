import { readPusdExchangeAllowance } from "@knoww/shared-types/approvals";
import { CTF_JSON_ABI } from "@knoww/shared-types/ctf";
import type { Address } from "viem";

import {
  CTF_ADDRESS,
  PUSD_ADDRESS,
  PUSD_DECIMALS,
  USDC_E_ADDRESS,
  USDC_E_DECIMALS,
} from "@/constants/contracts";
import { getRpcUrl } from "@/lib/rpc";

export async function readConditionalBalanceRaw(
  tokenId: string,
  owner: string
): Promise<bigint> {
  const { createPublicClient, http } = await import("viem");
  const { polygon } = await import("@/lib/chains");

  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(getRpcUrl()),
  });

  const balances = (await publicClient.readContract({
    address: CTF_ADDRESS as Address,
    abi: CTF_JSON_ABI,
    functionName: "balanceOfBatch",
    args: [[owner as Address], [BigInt(tokenId)]],
  })) as readonly bigint[];

  return balances[0] ?? BigInt(0);
}

const ERC20_BALANCE_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export async function readUsdcBalance(targetAddress: string) {
  const { createPublicClient, http, formatUnits } = await import("viem");
  const { polygon } = await import("@/lib/chains");

  const client = createPublicClient({
    chain: polygon,
    transport: http(getRpcUrl()),
  });

  const balance = await client.readContract({
    address: USDC_E_ADDRESS,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [targetAddress as `0x${string}`],
  });

  return {
    balance: Number(formatUnits(balance, USDC_E_DECIMALS)),
    balanceRaw: balance.toString(),
    decimals: USDC_E_DECIMALS,
  };
}

export async function readPusdBalance(targetAddress: string) {
  const { createPublicClient, http, formatUnits } = await import("viem");
  const { polygon } = await import("@/lib/chains");

  const client = createPublicClient({
    chain: polygon,
    transport: http(getRpcUrl()),
  });

  const balance = await client.readContract({
    address: PUSD_ADDRESS,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [targetAddress as `0x${string}`],
  });

  return {
    balance: Number(formatUnits(balance, PUSD_DECIMALS)),
    balanceRaw: balance.toString(),
    decimals: PUSD_DECIMALS,
  };
}

export async function readPusdAllowance(
  targetAddress: string,
  negRisk = false
) {
  const { createPublicClient, http, formatUnits } = await import("viem");
  const { polygon } = await import("@/lib/chains");

  const client = createPublicClient({
    chain: polygon,
    transport: http(getRpcUrl()),
  });

  const allowance = await readPusdExchangeAllowance(
    client,
    targetAddress as Address,
    negRisk
  );

  return {
    allowance: Number(formatUnits(allowance, PUSD_DECIMALS)),
    allowanceRaw: allowance.toString(),
    decimals: PUSD_DECIMALS,
    exchange: negRisk ? "NEG_RISK_CTF_EXCHANGE" : "CTF_EXCHANGE",
  };
}
