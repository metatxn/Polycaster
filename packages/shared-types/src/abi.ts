/**
 * Minimal contract ABIs shared by web and extension.
 *
 * Keep these fragments small: export only the calls we encode or read in the
 * apps, not full protocol ABIs.
 */

/**
 * Polymarket CollateralOnramp ABI.
 *
 * - `wrap(asset, to, amount)`: converts USDC.e to pUSD 1:1, crediting `to`.
 * - `unwrap(asset, to, amount)`: converts pUSD to USDC.e 1:1, crediting `to`.
 */
export const COLLATERAL_ONRAMP_ABI = [
  {
    inputs: [
      { name: "_asset", type: "address" },
      { name: "_to", type: "address" },
      { name: "_amount", type: "uint256" },
    ],
    name: "wrap",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "_asset", type: "address" },
      { name: "_to", type: "address" },
      { name: "_amount", type: "uint256" },
    ],
    name: "unwrap",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const COLLATERAL_ONRAMP_WRAP_ABI = [
  "function wrap(address _asset, address _to, uint256 _amount)",
] as const;
