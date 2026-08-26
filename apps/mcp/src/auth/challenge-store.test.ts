import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  consumeWalletChallenge,
  createWalletChallenge,
  type WalletChallenge,
} from "./challenge-store";

const challenge: WalletChallenge = {
  id: "0123456789abcdef0123456789abcdef",
  clientName: "Test Agent",
  expirationTime: "2099-01-01T00:05:00.000Z",
  issuedAt: "2099-01-01T00:00:00.000Z",
  resource: "https://mcp.knoww.app/mcp",
  scopes: ["markets:read"],
  oauthRequest: {
    clientId: "test-client",
    codeChallenge: "challenge",
    codeChallengeMethod: "S256",
    issuer: "https://mcp.knoww.app",
    redirectUri: "https://client.example/callback",
    resource: "https://mcp.knoww.app/mcp",
    responseType: "code",
    scope: ["markets:read"],
    state: "state-1",
  },
};

describe("WalletChallengeStore", () => {
  it("allows a challenge to be consumed exactly once", async () => {
    await createWalletChallenge(env.MCP_AUTH_CHALLENGES, challenge);

    await expect(
      consumeWalletChallenge(env.MCP_AUTH_CHALLENGES, challenge.id)
    ).resolves.toEqual(challenge);
    await expect(
      consumeWalletChallenge(env.MCP_AUTH_CHALLENGES, challenge.id)
    ).resolves.toBeNull();
  });

  it("does not return an expired challenge", async () => {
    const expired = {
      ...challenge,
      id: "fedcba9876543210fedcba9876543210",
      expirationTime: "2020-01-01T00:00:00.000Z",
    };
    await createWalletChallenge(env.MCP_AUTH_CHALLENGES, expired);

    await expect(
      consumeWalletChallenge(env.MCP_AUTH_CHALLENGES, expired.id)
    ).resolves.toBeNull();
  });
});
