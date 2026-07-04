import type { Address, WalletClient } from "viem";
import { describe, expect, it, vi } from "vitest";
import { polygon } from "@/lib/chains";
import { getViemWalletClient } from "./viem-wallet-client";

const connectedAccount =
  "0x0000000000000000000000000000000000000001" as Address;
const polygonChainId = `0x${polygon.id.toString(16)}`;

describe("getViemWalletClient", () => {
  it("does not request accounts again when the connected account is already known", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return polygonChainId;
      if (method === "eth_requestAccounts") return [connectedAccount];
      return null;
    });

    const client = await getViemWalletClient(
      { request } as unknown as WalletClient,
      connectedAccount
    );

    expect(client.account?.address).toBe(connectedAccount);
    const requestedMethods = request.mock.calls.map(
      ([args]: [{ method: string }]) => args.method
    );
    expect(requestedMethods).toContain("eth_chainId");
    expect(requestedMethods).not.toContain("eth_requestAccounts");
  });

  it("requests accounts when no connected account was provided", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return polygonChainId;
      if (method === "eth_requestAccounts") return [connectedAccount];
      return null;
    });

    await getViemWalletClient({ request } as unknown as WalletClient);

    expect(
      request.mock.calls.map(([args]: [{ method: string }]) => args.method)
    ).toContain("eth_requestAccounts");
  });
});
