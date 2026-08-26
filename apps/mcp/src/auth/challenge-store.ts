import { DurableObject } from "cloudflare:workers";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

const RECORD_KEY = "wallet-challenge";
const INTERNAL_ORIGIN = "https://wallet-challenge.internal";

export interface WalletChallenge {
  id: string;
  clientName: string;
  expirationTime: string;
  issuedAt: string;
  resource: string;
  scopes: string[];
  oauthRequest: AuthRequest;
}

function challengeStub(
  namespace: DurableObjectNamespace,
  challengeId: string
): DurableObjectStub {
  return namespace.get(namespace.idFromName(challengeId));
}

export async function createWalletChallenge(
  namespace: DurableObjectNamespace,
  challenge: WalletChallenge
): Promise<void> {
  const response = await challengeStub(namespace, challenge.id).fetch(
    new Request(`${INTERNAL_ORIGIN}/challenge`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(challenge),
    })
  );
  if (!response.ok) {
    throw new Error("Could not create wallet challenge.");
  }
}

export async function consumeWalletChallenge(
  namespace: DurableObjectNamespace,
  challengeId: string
): Promise<WalletChallenge | null> {
  const response = await challengeStub(namespace, challengeId).fetch(
    new Request(`${INTERNAL_ORIGIN}/challenge`, { method: "DELETE" })
  );
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error("Could not consume wallet challenge.");
  return response.json<WalletChallenge>();
}

export async function readWalletChallenge(
  namespace: DurableObjectNamespace,
  challengeId: string
): Promise<WalletChallenge | null> {
  const response = await challengeStub(namespace, challengeId).fetch(
    new Request(`${INTERNAL_ORIGIN}/challenge`)
  );
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error("Could not read wallet challenge.");
  return response.json<WalletChallenge>();
}

export class WalletChallengeStore extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return new Response(null, { status: 204 });
    }
    if (url.pathname !== "/challenge") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "PUT") {
      const existing = await this.ctx.storage.get(RECORD_KEY);
      if (existing !== undefined) {
        return new Response("Challenge already exists", { status: 409 });
      }
      const challenge = await request.json<WalletChallenge>();
      const expirationMs = Date.parse(challenge.expirationTime);
      if (!Number.isFinite(expirationMs)) {
        return new Response("Invalid challenge", { status: 400 });
      }
      await this.ctx.storage.put(RECORD_KEY, challenge);
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, expirationMs));
      return new Response(null, { status: 201 });
    }

    if (request.method === "DELETE") {
      const challenge = await this.ctx.storage.get<WalletChallenge>(RECORD_KEY);
      if (!challenge) return new Response(null, { status: 404 });

      await this.ctx.storage.delete(RECORD_KEY);
      await this.ctx.storage.deleteAlarm();
      if (Date.parse(challenge.expirationTime) <= Date.now()) {
        return new Response(null, { status: 410 });
      }
      return Response.json(challenge);
    }

    if (request.method === "GET") {
      const challenge = await this.ctx.storage.get<WalletChallenge>(RECORD_KEY);
      if (!challenge) return new Response(null, { status: 404 });
      if (Date.parse(challenge.expirationTime) <= Date.now()) {
        await this.ctx.storage.delete(RECORD_KEY);
        await this.ctx.storage.deleteAlarm();
        return new Response(null, { status: 410 });
      }
      return Response.json(challenge);
    }

    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, PUT, DELETE" },
    });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
