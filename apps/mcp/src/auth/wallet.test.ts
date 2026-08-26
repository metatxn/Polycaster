import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { buildWalletLoginMessage, verifyWalletLoginSignature } from "./wallet";

const account = privateKeyToAccount(generatePrivateKey());

const messageInput = {
  address: account.address,
  chainId: 137,
  challengeId: "0123456789abcdef0123456789abcdef",
  clientName: "Test Agent",
  expirationTime: "2026-08-26T12:05:00.000Z",
  issuedAt: "2026-08-26T12:00:00.000Z",
  resource: "https://mcp.knoww.app/mcp",
  scopes: ["markets:read"],
};

describe("wallet OAuth consent", () => {
  it("binds the signature message to the client, resource, and scopes", () => {
    const message = buildWalletLoginMessage(messageInput);

    expect(message).toContain("Test Agent");
    expect(message).toContain("URI: https://mcp.knoww.app/mcp");
    expect(message).toContain("Nonce: 0123456789abcdef0123456789abcdef");
    expect(message).toContain("urn:knoww:mcp:scope:markets%3Aread");
  });

  it("verifies the wallet that signed the exact consent message", async () => {
    const message = buildWalletLoginMessage(messageInput);
    const signature = await account.signMessage({ message });

    await expect(
      verifyWalletLoginSignature({
        address: account.address,
        message,
        signature,
      })
    ).resolves.toBe(account.address);
  });

  it("rejects a signature after consent details are changed", async () => {
    const message = buildWalletLoginMessage(messageInput);
    const signature = await account.signMessage({ message });

    await expect(
      verifyWalletLoginSignature({
        address: account.address,
        message: message.replace("markets%3Aread", "x402%3Apay"),
        signature,
      })
    ).resolves.toBeNull();
  });
});
