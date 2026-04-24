/**
 * Known centralized-exchange hot wallets and bridge contracts on
 * Polygon mainnet. Funding *from* these addresses is the "generic
 * retail" pattern — millions of users fund their wallets from
 * Binance / Coinbase / OKX, so a wallet that traces back to a CEX
 * hot wallet carries a weak insider signal.
 *
 * Funding from addresses NOT in this list is more likely self-
 * custody (another EOA, a DEX aggregator, a cold wallet transfer),
 * which is a much stronger signal for insider clustering: if two
 * flagged wallets share the same self-custody first-funder, one
 * operator likely runs both.
 *
 * Addresses are lowercased for direct Map lookup. Sources: Etherscan
 * tags on the Polygon chain, verified against on-chain volume
 * patterns. Not exhaustive — the signal value is asymmetric (false
 * negatives on CEX detection just lose us one denoising step, false
 * positives on "self-custody" don't happen because the test is
 * "not in the known CEX list").
 */

export type FunderCategory = "cex" | "bridge" | "self_custody" | "unknown";

export interface KnownAddress {
  label: string;
  type: "cex" | "bridge";
}

export const KNOWN_FUNDER_ADDRESSES: Record<string, KnownAddress> = {
  // Binance
  "0x505e71695e9bc45943c58adec1650577bca68fd9": {
    label: "Binance 14",
    type: "cex",
  },
  "0x290275e3db66394c52272398959845170e4dcb88": {
    label: "Binance 15",
    type: "cex",
  },
  "0xa7887df89a35fb2acea9f0d1f26d2f4aa2b5a69d": {
    label: "Binance Deposit",
    type: "cex",
  },
  "0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245": {
    label: "Binance Hot",
    type: "cex",
  },
  "0xf977814e90da44bfa03b6295a0616a897441acec": {
    label: "Binance 8",
    type: "cex",
  },

  // Coinbase
  "0x5a52e96bacdabb82fd05763e25335261b270efcb": {
    label: "Coinbase",
    type: "cex",
  },
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": {
    label: "Coinbase 1",
    type: "cex",
  },

  // OKX
  "0xae8a8bf4906f79f6d34a1fed38b817ce39f8651e": {
    label: "OKX",
    type: "cex",
  },
  "0x1a2cebbadec20b5c98a8fe1b4ebac3c0bf0bdc87": {
    label: "OKX Deposit",
    type: "cex",
  },

  // Kraken
  "0xda9dfa130df4de4673b89022ee50ff26f6ea73cf": {
    label: "Kraken",
    type: "cex",
  },

  // Bybit
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40": {
    label: "Bybit",
    type: "cex",
  },

  // Crypto.com
  "0x72a53cdbbcc1b9efa39c834a540550e23463aacb": {
    label: "Crypto.com",
    type: "cex",
  },
  "0x46340b20830761efd32832a74d7169b29feb9758": {
    label: "Crypto.com 2",
    type: "cex",
  },

  // Bitget
  "0x0639556f03714a74a5feeaf5736a4a64ff70d206": {
    label: "Bitget",
    type: "cex",
  },

  // KuCoin
  "0xd6216fc19db775df9774a6e33526131da7d19a2c": {
    label: "KuCoin",
    type: "cex",
  },

  // MEXC
  "0x3cc936b795a188f0e246cbb2d74c5bd190aecf18": {
    label: "MEXC",
    type: "cex",
  },

  // Gate.io
  "0x234ee9e35f8e9749a002fc42970d570db716453b": {
    label: "Gate.io",
    type: "cex",
  },

  // HTX / Huobi
  "0x5fdc9b6e4c9e27ac9c9894b0d1a21c6d5e5f8e88": {
    label: "HTX",
    type: "cex",
  },

  // Bridges (Polygon PoS, LayerZero, etc.)
  "0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf": {
    label: "Polygon PoS Bridge",
    type: "bridge",
  },
  "0xa0c68c638235ee32657e8f720a23cec1bfc77c77": {
    label: "Polygon PoS Bridge 2",
    type: "bridge",
  },
  "0x8f5bbb2bb8c2ee94639e55d5f41de9b4839c1280": {
    label: "Stargate",
    type: "bridge",
  },
  "0x45a01e4e04f14f7a4a6702c74187c5f6222033cd": {
    label: "Synapse",
    type: "bridge",
  },
  "0xf5b509bb0909a69b1c207e495f687a596c168e12": {
    label: "Hop Protocol",
    type: "bridge",
  },
  "0x25ace71c97b33cc4729cf772ae268934f7ab5106": {
    label: "Multichain",
    type: "bridge",
  },

  // Polymarket house accounts (deposits from these are trading mechanics
  // rather than real funding).
  "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e": {
    label: "Polymarket Exchange",
    type: "bridge",
  },
};

/**
 * Classify a funder address into one of four buckets. "self_custody"
 * is the default for any non-zero address we don't recognize — that's
 * the insider-clustering category. "unknown" only returns for null
 * or empty input.
 */
export function classifyFunder(
  address: string | null | undefined
): FunderCategory {
  if (!address) return "unknown";
  const hit = KNOWN_FUNDER_ADDRESSES[address.toLowerCase()];
  if (hit) return hit.type;
  return "self_custody";
}

/**
 * Human-readable label for a funder address. Returns the CEX/bridge
 * label if known, otherwise a shortened hex form.
 */
export function funderLabel(address: string | null | undefined): string {
  if (!address) return "—";
  const hit = KNOWN_FUNDER_ADDRESSES[address.toLowerCase()];
  if (hit) return hit.label;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
