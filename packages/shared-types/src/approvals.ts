import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  type Hex,
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
} from "./contracts";

export const APPROVAL_THRESHOLD_RAW = BigInt(1);

export interface ApprovalTransaction {
  to: Address;
  data: Hex;
  value: "0";
}

export interface ReadErc20AllowanceOptions {
  token?: Address;
  fallbackRaw?: bigint;
}

export interface ReadErc1155ApprovalOptions {
  token?: Address;
  fallbackApproved?: boolean;
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
  /** USDC.e approval to CollateralOnramp for wrap(). */
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
    if (options.fallbackRaw !== undefined) return options.fallbackRaw;
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
  const allApproved = clobTradingApproved && autoWrapApproved;

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

export function buildTradingApprovalTransactions(
  status: TradingApprovalStatus,
  approvalAmountRaw: bigint
): ApprovalTransaction[] {
  const txns: ApprovalTransaction[] = [];

  const pusdTargets: Array<[boolean, Address]> = [
    [status.pusdCtf, PUSD_CTF_APPROVAL_TARGET as Address],
    [status.pusdCtfExchange, CTF_EXCHANGE_ADDRESS as Address],
    [status.pusdNegRiskExchange, NEG_RISK_CTF_EXCHANGE_ADDRESS as Address],
    // CLOB V2 pulls pUSD via the neg-risk adapter for neg-risk market orders.
    [status.pusdNegRiskAdapter, NEG_RISK_ADAPTER_ADDRESS as Address],
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
