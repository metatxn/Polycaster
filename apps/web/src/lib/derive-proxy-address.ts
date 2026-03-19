import {
  SAFE_FACTORY_ADDRESS,
  SAFE_INIT_CODE_HASH,
} from "@/constants/contracts";

/**
 * Derive the Polymarket Safe proxy address for an EOA using CREATE2.
 *
 * This is deterministic — the same EOA always produces the same Safe address.
 * Uses viem's getCreate2Address for exact compatibility with Polymarket's
 * address derivation scheme.
 */
export async function deriveProxyAddress(eoaAddress: string): Promise<string> {
  const { getCreate2Address, keccak256, encodeAbiParameters } = await import(
    "viem"
  );

  const salt = keccak256(
    encodeAbiParameters(
      [{ name: "address", type: "address" }],
      [eoaAddress as `0x${string}`]
    )
  );

  const proxyAddress = getCreate2Address({
    from: SAFE_FACTORY_ADDRESS as `0x${string}`,
    salt,
    bytecodeHash: SAFE_INIT_CODE_HASH as `0x${string}`,
  });

  return proxyAddress;
}
