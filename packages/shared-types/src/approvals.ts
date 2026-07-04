import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  maxUint256,
  type PublicClient,
} from "viem";
import {
  COLLATERAL_ONRAMP_ADDRESS,
  CTF_ADDRESS,
  CTF_COLLATERAL_ADAPTER_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
  NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  PUSD_ADDRESS,
  PUSD_CTF_APPROVAL_TARGET,
  USDC_E_ADDRESS,
} from "./contracts.ts";

export const APPROVAL_THRESHOLD_RAW = BigInt(1);

export interface ApprovalTransaction {
  to: Address;
  data: Hex;
  value: "0";
}

export interface ReadErc20AllowanceOptions {
  token?: Address;
  fallbackRaw?: bigint;
  /** Called when a read fails and the fallback value is returned. */
  onFallback?: (error: unknown) => void;
}

export interface ReadErc1155ApprovalOptions {
  token?: Address;
  fallbackApproved?: boolean;
  /** Called when a read fails and the fallback value is returned. */
  onFallback?: (error: unknown) => void;
}

export interface TradingApprovalStatus {
  /** pUSD direct CTF approval, listed by Polymarket docs for split/mint flows. */
  pusdCtf: boolean;
  /** pUSD approvals for CLOB V2 BUY collateral settlement. */
  pusdCtfExchange: boolean;
  pusdNegRiskExchange: boolean;
  /** pUSD approvals for adapter-specific CTF/conversion operations. */
  pusdNegRiskAdapter: boolean;
  pusdCtfCollateralAdapter: boolean;
  pusdNegRiskCtfCollateralAdapter: boolean;
  /**
   * USDC.e approval to CollateralOnramp for wrap(). Informational only: the
   * auto-wrap batch bundles its own exact approve and consumes it entirely,
   * zeroing any standing allowance — so this must not gate trading readiness
   * or setup completion (it would re-fail after every wrap-funded BUY).
   */
  usdcOnramp: boolean;
  /** ERC1155 outcome token operator approvals for CLOB/adapter operations. */
  ctfExchangeApproval: boolean;
  ctfNegRiskExchangeApproval: boolean;
  ctfNegRiskAdapterApproval: boolean;
  ctfCollateralAdapterApproval: boolean;
  ctfNegRiskCollateralAdapterApproval: boolean;
  /** True when the default app trading setup is complete. */
  allApproved: boolean;
  /** True when CLOB buy/sell exchange approvals are complete. */
  clobTradingApproved: boolean;
  /** True when USDC.e can be wrapped into pUSD on demand. */
  autoWrapApproved: boolean;
  /** True when split/merge/redeem adapter approvals are complete. */
  ctfOperationsApproved: boolean;
  /** True when neg-risk conversion adapter approvals are complete. */
  negRiskConversionApproved: boolean;
}

export interface ClobOrderApprovalRequirement {
  side: "BUY" | "SELL";
  negRisk?: boolean;
}

const ERC1155_APPROVAL_ABI = [
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
  {
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    name: "setApprovalForAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

function allowanceResultOk(
  result: { status: "success"; result: unknown } | { status: "failure" },
  approvalAmountRaw: bigint
): boolean {
  return (
    result.status === "success" &&
    typeof result.result === "bigint" &&
    result.result >= approvalAmountRaw
  );
}

function approvalResultOk(
  result: { status: "success"; result: unknown } | { status: "failure" }
): boolean {
  return result.status === "success" && result.result === true;
}

export function getPusdExchangeApprovalSpender(negRisk?: boolean): Address {
  return (
    negRisk ? NEG_RISK_CTF_EXCHANGE_ADDRESS : CTF_EXCHANGE_ADDRESS
  ) as Address;
}

export function isClobOrderApproved(
  status: TradingApprovalStatus,
  requirement: ClobOrderApprovalRequirement
): boolean {
  if (requirement.side === "SELL") {
    // Neg-risk settlement moves outcome tokens through the adapter as well as
    // the exchange — same operator pair clobTradingApproved requires.
    return requirement.negRisk
      ? status.ctfNegRiskExchangeApproval && status.ctfNegRiskAdapterApproval
      : status.ctfExchangeApproval;
  }

  // No standing USDC.e→onramp allowance is required for a BUY: the auto-wrap
  // batch (buildPusdAutoWrapTransactions) carries its own exact approve and
  // consumes it whole, zeroing any standing allowance — gating orders on it
  // would re-fail after every wrap-funded BUY.
  return requirement.negRisk
    ? status.pusdNegRiskExchange && status.pusdNegRiskAdapter
    : status.pusdCtfExchange;
}

export function buildClobOrderApprovalTransactions(
  status: TradingApprovalStatus,
  requirement: ClobOrderApprovalRequirement
): ApprovalTransaction[] {
  const txns: ApprovalTransaction[] = [];

  if (requirement.side === "SELL") {
    const operatorTargets: Array<[boolean, Address]> = requirement.negRisk
      ? [
          [
            status.ctfNegRiskExchangeApproval,
            NEG_RISK_CTF_EXCHANGE_ADDRESS as Address,
          ],
          [
            status.ctfNegRiskAdapterApproval,
            NEG_RISK_ADAPTER_ADDRESS as Address,
          ],
        ]
      : [[status.ctfExchangeApproval, CTF_EXCHANGE_ADDRESS as Address]];
    for (const [approved, operator] of operatorTargets) {
      if (!approved) {
        txns.push(buildErc1155ApprovalTransaction(operator));
      }
    }
    return txns;
  }

  const pusdTargets: Array<[boolean, Address, bigint]> = requirement.negRisk
    ? [
        [
          status.pusdNegRiskExchange,
          NEG_RISK_CTF_EXCHANGE_ADDRESS as Address,
          maxUint256,
        ],
        [
          status.pusdNegRiskAdapter,
          NEG_RISK_ADAPTER_ADDRESS as Address,
          maxUint256,
        ],
      ]
    : [[status.pusdCtfExchange, CTF_EXCHANGE_ADDRESS as Address, maxUint256]];

  appendMissingPusdApprovalTransactions(txns, pusdTargets);

  // Deliberately no USDC.e→onramp grant here: the auto-wrap batch approves the
  // exact wrap amount itself, so a standing allowance is never consumed as a
  // prerequisite — granting one per order would just be an extra signature.
  return txns;
}

export async function readErc20Allowance(
  client: PublicClient,
  owner: Address,
  spender: Address,
  options: ReadErc20AllowanceOptions = {}
): Promise<bigint> {
  try {
    return await client.readContract({
      address: options.token ?? (PUSD_ADDRESS as Address),
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    });
  } catch (err) {
    if (options.fallbackRaw !== undefined) {
      options.onFallback?.(err);
      return options.fallbackRaw;
    }
    throw err;
  }
}

export function readPusdExchangeAllowance(
  client: PublicClient,
  owner: Address,
  negRisk?: boolean,
  options: Omit<ReadErc20AllowanceOptions, "token"> = {}
): Promise<bigint> {
  return readErc20Allowance(
    client,
    owner,
    getPusdExchangeApprovalSpender(negRisk),
    options
  );
}

/**
 * Effective pUSD allowance available to a CLOB order: the exchange allowance,
 * and for neg-risk markets the minimum of the exchange and NegRiskAdapter
 * allowances (CLOB V2 pulls collateral through both). This is the single
 * owner of the "which spenders must cover a neg-risk order" rule for on-chain
 * reads; the same rule over an allowance map lives in the extension's
 * setup-flow `getTradingOrderAllowance`.
 */
export async function readClobOrderPusdAllowance(
  client: PublicClient,
  owner: Address,
  negRisk?: boolean,
  options: Omit<ReadErc20AllowanceOptions, "token"> = {}
): Promise<bigint> {
  const [exchangeAllowance, adapterAllowance] = await Promise.all([
    readPusdExchangeAllowance(client, owner, negRisk, options),
    negRisk
      ? readErc20Allowance(
          client,
          owner,
          NEG_RISK_ADAPTER_ADDRESS as Address,
          options
        )
      : Promise.resolve(null),
  ]);
  if (adapterAllowance === null) return exchangeAllowance;
  return exchangeAllowance < adapterAllowance
    ? exchangeAllowance
    : adapterAllowance;
}

export async function readErc1155Approval(
  client: PublicClient,
  owner: Address,
  operator: Address,
  options: ReadErc1155ApprovalOptions = {}
): Promise<boolean> {
  try {
    return await client.readContract({
      address: options.token ?? (CTF_ADDRESS as Address),
      abi: ERC1155_APPROVAL_ABI,
      functionName: "isApprovedForAll",
      args: [owner, operator],
    });
  } catch (err) {
    if (options.fallbackApproved !== undefined) {
      options.onFallback?.(err);
      return options.fallbackApproved;
    }
    throw err;
  }
}

export async function readTradingApprovalStatus(
  client: PublicClient,
  owner: Address,
  options: {
    approvalAmountRaw?: bigint;
  } = {}
): Promise<TradingApprovalStatus> {
  const approvalAmountRaw = options.approvalAmountRaw ?? APPROVAL_THRESHOLD_RAW;

  const results = await client.multicall({
    allowFailure: true,
    contracts: [
      {
        address: PUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, PUSD_CTF_APPROVAL_TARGET],
      },
      {
        address: PUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, CTF_EXCHANGE_ADDRESS],
      },
      {
        address: PUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, NEG_RISK_CTF_EXCHANGE_ADDRESS],
      },
      {
        address: PUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, NEG_RISK_ADAPTER_ADDRESS],
      },
      {
        address: PUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, CTF_COLLATERAL_ADAPTER_ADDRESS],
      },
      {
        address: PUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS],
      },
      {
        address: USDC_E_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, COLLATERAL_ONRAMP_ADDRESS],
      },
      {
        address: CTF_ADDRESS,
        abi: ERC1155_APPROVAL_ABI,
        functionName: "isApprovedForAll",
        args: [owner, CTF_EXCHANGE_ADDRESS],
      },
      {
        address: CTF_ADDRESS,
        abi: ERC1155_APPROVAL_ABI,
        functionName: "isApprovedForAll",
        args: [owner, NEG_RISK_CTF_EXCHANGE_ADDRESS],
      },
      {
        address: CTF_ADDRESS,
        abi: ERC1155_APPROVAL_ABI,
        functionName: "isApprovedForAll",
        args: [owner, NEG_RISK_ADAPTER_ADDRESS],
      },
      {
        address: CTF_ADDRESS,
        abi: ERC1155_APPROVAL_ABI,
        functionName: "isApprovedForAll",
        args: [owner, CTF_COLLATERAL_ADAPTER_ADDRESS],
      },
      {
        address: CTF_ADDRESS,
        abi: ERC1155_APPROVAL_ABI,
        functionName: "isApprovedForAll",
        args: [owner, NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS],
      },
    ],
  });

  const pusdCtf = allowanceResultOk(results[0], approvalAmountRaw);
  const pusdCtfExchange = allowanceResultOk(results[1], approvalAmountRaw);
  const pusdNegRiskExchange = allowanceResultOk(results[2], approvalAmountRaw);
  const pusdNegRiskAdapter = allowanceResultOk(results[3], approvalAmountRaw);
  const pusdCtfCollateralAdapter = allowanceResultOk(
    results[4],
    approvalAmountRaw
  );
  const pusdNegRiskCtfCollateralAdapter = allowanceResultOk(
    results[5],
    approvalAmountRaw
  );
  const usdcOnramp = allowanceResultOk(results[6], approvalAmountRaw);
  const ctfExchangeApproval = approvalResultOk(results[7]);
  const ctfNegRiskExchangeApproval = approvalResultOk(results[8]);
  const ctfNegRiskAdapterApproval = approvalResultOk(results[9]);
  const ctfCollateralAdapterApproval = approvalResultOk(results[10]);
  const ctfNegRiskCollateralAdapterApproval = approvalResultOk(results[11]);

  const clobTradingApproved =
    pusdCtf &&
    pusdCtfExchange &&
    pusdNegRiskExchange &&
    pusdNegRiskAdapter &&
    ctfExchangeApproval &&
    ctfNegRiskExchangeApproval &&
    ctfNegRiskAdapterApproval;
  const autoWrapApproved = usdcOnramp;
  const ctfOperationsApproved =
    pusdCtf &&
    pusdCtfCollateralAdapter &&
    pusdNegRiskCtfCollateralAdapter &&
    ctfCollateralAdapterApproval &&
    ctfNegRiskCollateralAdapterApproval;
  const negRiskConversionApproved =
    pusdNegRiskAdapter &&
    ctfNegRiskAdapterApproval &&
    ctfNegRiskCollateralAdapterApproval;
  // autoWrapApproved is deliberately excluded: every auto-wrap zeroes the
  // standing onramp allowance (exact self-approve, fully consumed), so
  // including it would flip "all approved" back to false after the first
  // wrap-funded BUY and re-trigger setup/approval prompts forever.
  const allApproved = clobTradingApproved;

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
    clobTradingApproved,
    autoWrapApproved,
    ctfOperationsApproved,
    negRiskConversionApproved,
  };
}

export function buildErc20ApprovalTransaction(
  token: Address,
  spender: Address,
  approvalAmountRaw: bigint
): ApprovalTransaction {
  return {
    to: token,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, approvalAmountRaw],
    }),
    value: "0",
  };
}

export function buildErc1155ApprovalTransaction(
  operator: Address
): ApprovalTransaction {
  return {
    to: CTF_ADDRESS as Address,
    data: encodeFunctionData({
      abi: ERC1155_APPROVAL_ABI,
      functionName: "setApprovalForAll",
      args: [operator, true],
    }),
    value: "0",
  };
}

export function buildCtfCollateralApprovalTransaction(
  spender: Address,
  approvalAmountRaw: bigint
): ApprovalTransaction {
  return buildErc20ApprovalTransaction(
    PUSD_ADDRESS as Address,
    spender,
    approvalAmountRaw
  );
}

function appendMissingPusdApprovalTransactions(
  txns: ApprovalTransaction[],
  targets: Array<[boolean, Address, bigint]>
): void {
  for (const [approved, spender, amountRaw] of targets) {
    if (!approved) {
      txns.push(
        buildErc20ApprovalTransaction(
          PUSD_ADDRESS as Address,
          spender,
          amountRaw
        )
      );
    }
  }
}

export function buildTradingApprovalTransactions(
  status: TradingApprovalStatus,
  approvalAmountRaw: bigint
): ApprovalTransaction[] {
  const txns: ApprovalTransaction[] = [];

  const pusdTargets: Array<[boolean, Address, bigint]> = [
    [status.pusdCtf, PUSD_CTF_APPROVAL_TARGET as Address, approvalAmountRaw],
    [status.pusdCtfExchange, CTF_EXCHANGE_ADDRESS as Address, maxUint256],
    [
      status.pusdNegRiskExchange,
      NEG_RISK_CTF_EXCHANGE_ADDRESS as Address,
      maxUint256,
    ],
    // CLOB V2 pulls pUSD via the neg-risk adapter for neg-risk market orders.
    [
      status.pusdNegRiskAdapter,
      NEG_RISK_ADAPTER_ADDRESS as Address,
      maxUint256,
    ],
  ];
  appendMissingPusdApprovalTransactions(txns, pusdTargets);

  if (!status.usdcOnramp) {
    txns.push(
      buildErc20ApprovalTransaction(
        USDC_E_ADDRESS as Address,
        COLLATERAL_ONRAMP_ADDRESS as Address,
        approvalAmountRaw
      )
    );
  }

  const ctfTargets: Array<[boolean, Address]> = [
    [status.ctfExchangeApproval, CTF_EXCHANGE_ADDRESS as Address],
    [
      status.ctfNegRiskExchangeApproval,
      NEG_RISK_CTF_EXCHANGE_ADDRESS as Address,
    ],
    [status.ctfNegRiskAdapterApproval, NEG_RISK_ADAPTER_ADDRESS as Address],
  ];
  for (const [approved, operator] of ctfTargets) {
    if (!approved) {
      txns.push(buildErc1155ApprovalTransaction(operator));
    }
  }

  return txns;
}

export function buildCtfOperationApprovalTransactions(
  status: TradingApprovalStatus,
  approvalAmountRaw: bigint
): ApprovalTransaction[] {
  const txns: ApprovalTransaction[] = [];

  const pusdTargets: Array<[boolean, Address]> = [
    [status.pusdCtf, PUSD_CTF_APPROVAL_TARGET as Address],
    [
      status.pusdCtfCollateralAdapter,
      CTF_COLLATERAL_ADAPTER_ADDRESS as Address,
    ],
    [
      status.pusdNegRiskCtfCollateralAdapter,
      NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS as Address,
    ],
  ];
  for (const [approved, spender] of pusdTargets) {
    if (!approved) {
      txns.push(
        buildErc20ApprovalTransaction(
          PUSD_ADDRESS as Address,
          spender,
          approvalAmountRaw
        )
      );
    }
  }

  const ctfTargets: Array<[boolean, Address]> = [
    [
      status.ctfCollateralAdapterApproval,
      CTF_COLLATERAL_ADAPTER_ADDRESS as Address,
    ],
    [
      status.ctfNegRiskCollateralAdapterApproval,
      NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS as Address,
    ],
  ];
  for (const [approved, operator] of ctfTargets) {
    if (!approved) {
      txns.push(buildErc1155ApprovalTransaction(operator));
    }
  }

  return txns;
}

export function buildNegRiskConversionApprovalTransactions(
  status: TradingApprovalStatus,
  approvalAmountRaw: bigint
): ApprovalTransaction[] {
  const txns: ApprovalTransaction[] = [];

  if (!status.pusdNegRiskAdapter) {
    txns.push(
      buildErc20ApprovalTransaction(
        PUSD_ADDRESS as Address,
        NEG_RISK_ADAPTER_ADDRESS as Address,
        approvalAmountRaw
      )
    );
  }

  const ctfTargets: Array<[boolean, Address]> = [
    [status.ctfNegRiskAdapterApproval, NEG_RISK_ADAPTER_ADDRESS as Address],
    [
      status.ctfNegRiskCollateralAdapterApproval,
      NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS as Address,
    ],
  ];
  for (const [approved, operator] of ctfTargets) {
    if (!approved) {
      txns.push(buildErc1155ApprovalTransaction(operator));
    }
  }

  return txns;
}

export function buildAllApprovalTransactions(
  status: TradingApprovalStatus,
  approvalAmountRaw: bigint
): ApprovalTransaction[] {
  const txns = [
    ...buildTradingApprovalTransactions(status, approvalAmountRaw),
    ...buildCtfOperationApprovalTransactions(status, approvalAmountRaw),
    ...buildNegRiskConversionApprovalTransactions(status, approvalAmountRaw),
  ];
  const seen = new Set<string>();
  return txns.filter((tx) => {
    const key = `${tx.to}:${tx.data}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildFullTradingApprovalTransactions(
  approvalAmountRaw: bigint
): ApprovalTransaction[] {
  return buildTradingApprovalTransactions(
    {
      pusdCtf: false,
      pusdCtfExchange: false,
      pusdNegRiskExchange: false,
      pusdNegRiskAdapter: false,
      pusdCtfCollateralAdapter: false,
      pusdNegRiskCtfCollateralAdapter: false,
      usdcOnramp: false,
      ctfExchangeApproval: false,
      ctfNegRiskExchangeApproval: false,
      ctfNegRiskAdapterApproval: false,
      ctfCollateralAdapterApproval: false,
      ctfNegRiskCollateralAdapterApproval: false,
      allApproved: false,
      clobTradingApproved: false,
      autoWrapApproved: false,
      ctfOperationsApproved: false,
      negRiskConversionApproved: false,
    },
    approvalAmountRaw
  );
}
