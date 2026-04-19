/**
 * Contract ABIs used by web hooks.
 *
 * Keep these minimal — export only the fragments the app needs to encode
 * calldata or read state. Full ABIs live in the relevant SDK packages.
 */

/**
 * Polymarket CollateralOnramp ABI (minimal).
 *
 * - `wrap(asset, to, amount)`: converts USDC.e → pUSD 1:1, crediting `to`.
 * - `unwrap(asset, to, amount)`: converts pUSD → USDC.e 1:1, crediting `to`.
 *
 * `to` does not have to equal `msg.sender`, so the Polymarket relayer can
 * wrap on a user's behalf as part of a Safe multiSend batch.
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
