import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTraderXProfileIndex,
  normalizeXHandle,
} from "./trader-x-profile.ts";

test("normalizeXHandle validates X username format", () => {
  assert.equal(normalizeXHandle("@EventWavesIO"), "eventwavesio");
  assert.equal(normalizeXHandle("bad-handle"), null);
  assert.equal(normalizeXHandle("this_handle_is_too_long"), null);
});

test("buildTraderXProfileIndex indexes only verified xUsername entries", () => {
  const index = buildTraderXProfileIndex([
    {
      rank: "1",
      proxyWallet: "0x1111111111111111111111111111111111111111",
      userName: "EventWaves",
      xUsername: "EventWavesIO",
      pnl: 33725.42,
      vol: 100000,
      profileImage: "https://example.com/avatar.png",
      verifiedBadge: true,
    },
    {
      rank: "2",
      proxyWallet: "0x2222222222222222222222222222222222222222",
      userName: "NoX",
      xUsername: "",
      pnl: 10,
      vol: 20,
      profileImage: null,
      verifiedBadge: false,
    },
  ]);

  assert.equal(
    index.get("eventwavesio")?.proxyWallet,
    "0x1111111111111111111111111111111111111111"
  );
  assert.equal(index.has("nox"), false);
});
