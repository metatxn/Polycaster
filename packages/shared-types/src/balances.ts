import { Decimal } from "decimal.js";
import {
  type Address,
  erc20Abi,
  formatEther,
  formatUnits,
  type PublicClient,
} from "viem";
import {
  PUSD_ADDRESS,
  PUSD_DECIMALS,
  USDC_E_ADDRESS,
  USDC_E_DECIMALS,
} from "./contracts.ts";

export interface PolygonTokenDefinition {
  symbol: string;
  name?: string;
  address: Address;
  decimals: number;
}

export interface TokenBalanceEntry {
  symbol: string;
  amount: number;
  amountRaw: string;
  address: Address;
  decimals: number;
}

export interface TradingWalletBalance {
  /** Effective BUY collateral: pUSD + USDC.e. */
  balance: number;
  balanceRaw: string;
  /** Real pUSD held by the wallet. Required for split/merge. */
  pusdBalance: number;
  pusdBalanceRaw: string;
  /** Legacy USDC.e held by the wallet. Auto-wrapped before BUY orders. */
  usdcEBalance: number;
  usdcEBalanceRaw: string;
  polBalance: number;
  polBalanceRaw: string;
  tokenBalances: TokenBalanceEntry[];
  isDeployed?: boolean;
}

export const TRADING_COLLATERAL_TOKENS = [
  {
    symbol: "pUSD",
    name: "Polymarket USD",
    address: PUSD_ADDRESS as Address,
    decimals: PUSD_DECIMALS,
  },
  {
    symbol: "USDC.e",
    name: "Bridged USDC",
    address: USDC_E_ADDRESS as Address,
    decimals: USDC_E_DECIMALS,
  },
] as const satisfies readonly PolygonTokenDefinition[];

export const POLYGON_WALLET_TOKENS = [
  ...TRADING_COLLATERAL_TOKENS,
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    decimals: 6,
  },
  {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    decimals: 18,
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    decimals: 18,
  },
  {
    symbol: "WMATIC",
    name: "Wrapped Matic",
    address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    decimals: 18,
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
    decimals: 8,
  },
] as const satisfies readonly PolygonTokenDefinition[];

export async function readTradingWalletBalance(
  client: PublicClient,
  owner: Address,
  options: {
    tokens?: readonly PolygonTokenDefinition[];
    includeNative?: boolean;
    includeDeployment?: boolean;
  } = {}
): Promise<TradingWalletBalance> {
  const tokens = options.tokens ?? TRADING_COLLATERAL_TOKENS;

  const [results, polBalanceRaw, safeCode] = await Promise.all([
    client.multicall({
      allowFailure: true,
      contracts: tokens.map((token) => ({
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      })),
    }),
    options.includeNative
      ? client.getBalance({ address: owner }).catch(() => BigInt(0))
      : Promise.resolve(BigInt(0)),
    options.includeDeployment
      ? client.getBytecode({ address: owner }).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  let pusdRaw = BigInt(0);
  let usdcERaw = BigInt(0);
  const tokenBalances: TokenBalanceEntry[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const result = results[i];
    const raw =
      result?.status === "success" && typeof result.result === "bigint"
        ? result.result
        : BigInt(0);
    const amount = Number(formatUnits(raw, token.decimals));

    if (token.address.toLowerCase() === PUSD_ADDRESS.toLowerCase()) {
      pusdRaw = raw;
    }
    if (token.address.toLowerCase() === USDC_E_ADDRESS.toLowerCase()) {
      usdcERaw = raw;
    }
    if (raw > BigInt(0)) {
      tokenBalances.push({
        symbol: token.symbol,
        amount,
        amountRaw: raw.toString(),
        address: token.address,
        decimals: token.decimals,
      });
    }
  }

  const pusdBalanceDecimal = new Decimal(formatUnits(pusdRaw, PUSD_DECIMALS));
  const usdcEBalanceDecimal = new Decimal(
    formatUnits(usdcERaw, USDC_E_DECIMALS)
  );
  const pusdBalance = pusdBalanceDecimal.toNumber();
  const usdcEBalance = usdcEBalanceDecimal.toNumber();
  const balanceRaw = (pusdRaw + usdcERaw).toString();
  const polBalance = Number(formatEther(polBalanceRaw));

  return {
    balance: pusdBalanceDecimal.plus(usdcEBalanceDecimal).toNumber(),
    balanceRaw,
    pusdBalance,
    pusdBalanceRaw: pusdRaw.toString(),
    usdcEBalance,
    usdcEBalanceRaw: usdcERaw.toString(),
    polBalance,
    polBalanceRaw: polBalanceRaw.toString(),
    tokenBalances,
    ...(options.includeDeployment
      ? { isDeployed: !!safeCode && safeCode !== "0x" }
      : {}),
  };
}
