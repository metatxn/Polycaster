import assert from "node:assert/strict";
import test from "node:test";
import { createAgentRepository } from "./repository.ts";

function createFakeD1() {
  const clobCredentials = new Map();
  const queries = [];
  return {
    queries,
    prepare(query) {
      queries.push(query);
      let bindings = [];
      return {
        bind(...values) {
          bindings = values;
          return this;
        },
        async run() {
          if (/INSERT OR REPLACE INTO agent_clob_credentials/i.test(query)) {
            const [
              credentialKey,
              clobHost,
              signerAddress,
              funderAddress,
              encryptedCredentials,
              encryptionKeyVersion,
              createdAt,
              updatedAt,
              lastUsedAt,
            ] = bindings;
            clobCredentials.set(credentialKey, {
              credential_key: credentialKey,
              clob_host: clobHost,
              signer_address: signerAddress,
              funder_address: funderAddress,
              encrypted_credentials: encryptedCredentials,
              encryption_key_version: encryptionKeyVersion,
              created_at: createdAt,
              updated_at: updatedAt,
              last_used_at: lastUsedAt,
            });
          } else if (
            /UPDATE agent_clob_credentials SET last_used_at = \?/i.test(query)
          ) {
            const [lastUsedAt, credentialKey] = bindings;
            const existing = clobCredentials.get(credentialKey);
            if (existing) {
              clobCredentials.set(credentialKey, {
                ...existing,
                last_used_at: lastUsedAt,
              });
            }
          }
          return {};
        },
        async first() {
          if (
            /FROM agent_clob_credentials WHERE credential_key = \?/i.test(query)
          ) {
            const row = clobCredentials.get(bindings[0]);
            return row ? { ...row } : null;
          }
          return null;
        },
        async all() {
          if (/PRAGMA table_info\(agent_watchlist\)/i.test(query)) {
            return { results: [] };
          }
          return { results: [] };
        },
      };
    },
  };
}

function watchlistInput(overrides = {}) {
  return {
    question: "Will the test market resolve Yes?",
    tokenId: `token-${crypto.randomUUID()}`,
    conditionId: "condition-1",
    marketSlug: "test-market",
    side: "YES",
    outcomeLabel: "Yes",
    marketType: "binary",
    eventType: "single_market",
    outcomes: ["Yes", "No"],
    newsUrls: [],
    socialNotes: [],
    active: true,
    ...overrides,
  };
}

test("upsertWatchlistItem dedupes imported rows by token id", async () => {
  const repo = createAgentRepository();
  const first = await repo.upsertWatchlistItem(
    watchlistInput({ tokenId: "shared-token", question: "First question?" })
  );
  const second = await repo.upsertWatchlistItem(
    watchlistInput({ tokenId: "shared-token", question: "Updated question?" })
  );

  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.question, "Updated question?");
  const matches = (await repo.listWatchlist()).filter(
    (item) => item.tokenId === "shared-token"
  );
  assert.equal(matches.length, 1);
});

test("D1 repository persists encrypted CLOB credentials without plaintext columns", async () => {
  const db = createFakeD1();
  const repo = createAgentRepository(db);

  const inserted = await repo.upsertClobCredential({
    credentialKey:
      "https://clob.polymarket.com:0x0000000000000000000000000000000000000001:0x0000000000000000000000000000000000000001",
    clobHost: "https://clob.polymarket.com",
    signerAddress: "0x0000000000000000000000000000000000000001",
    funderAddress: "0x0000000000000000000000000000000000000001",
    encryptedCredentials:
      '{"v":1,"alg":"AES-GCM","iv":"test-iv","ciphertext":"encrypted"}',
    encryptionKeyVersion: "v1",
  });
  const fetched = await repo.getClobCredential(inserted.credentialKey);

  assert.equal(fetched?.credentialKey, inserted.credentialKey);
  assert.equal(fetched?.encryptedCredentials, inserted.encryptedCredentials);
  assert.equal(fetched?.encryptionKeyVersion, "v1");
  assert.equal(fetched?.lastUsedAt !== null, true);
  assert.equal(
    db.queries.some((query) =>
      /CREATE TABLE IF NOT EXISTS agent_clob_credentials/i.test(query)
    ),
    true
  );
  assert.equal(
    db.queries.some((query) =>
      /api_secret|api_passphrase|api_key/i.test(query)
    ),
    false
  );
});

test("repository preserves live order lifecycle reconciliation fields", async () => {
  const repo = createAgentRepository();
  const idempotencyKey = `live-reconcile-${crypto.randomUUID()}:watch:BUY`;

  await repo.upsertLiveOrder({
    idempotencyKey,
    runId: "run-live",
    watchlistItemId: "watch-live",
    tokenId: "token-live",
    side: "BUY",
    requestedSizeUsd: "5",
    price: "0.50",
    signedOrderHash: "hash",
    orderId: "order-live",
    status: "PARTIALLY_FILLED",
    submittedAt: "2026-05-14T00:00:00.000Z",
    filledAt: "2026-05-14T00:00:01.000Z",
    filledNotionalUsd: "2.5",
    filledShares: "5",
    averageFillPrice: "0.5",
    lastSyncedAt: "2026-05-14T00:00:02.000Z",
    balanceSnapshotJson: '{"conditionalBalanceRaw":"5000000"}',
    dryRun: false,
    error: null,
  });

  const record = await repo.getLiveOrderByIdempotencyKey(idempotencyKey);

  assert.equal(record?.status, "PARTIALLY_FILLED");
  assert.equal(record?.filledNotionalUsd, "2.5");
  assert.equal(record?.filledShares, "5");
  assert.equal(record?.averageFillPrice, "0.5");
  assert.equal(
    record?.balanceSnapshotJson,
    '{"conditionalBalanceRaw":"5000000"}'
  );
});
