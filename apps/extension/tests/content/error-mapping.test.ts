import assert from "node:assert/strict";
import { test } from "vitest";
import { mapTradingError } from "../../src/content/trading/error-mapping";

test("undeployed trading wallet errors direct users to the setup flow", () => {
  const mapped = mapTradingError(
    "Your deposit wallet is not deployed. Complete trading wallet setup first."
  );

  assert.equal(mapped.title, "Trading wallet not set up");
  assert.equal(
    mapped.body,
    "Create your trading vault in the Knoww setup flow, then retry."
  );
  assert.doesNotMatch(mapped.body, /knoww\.app/i);
});

test("relayer infrastructure rejections are not mapped as user cancellations", () => {
  const mapped = mapTradingError(
    'Relayer 400: {"success":false,"error":"Relayer create request rejected"}'
  );

  assert.notEqual(mapped.title, "Signing cancelled");
});
