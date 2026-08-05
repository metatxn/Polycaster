import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientClobPostOrderError,
  postClobOrderWithRetry,
  resolvePreferredTradingWalletMode,
} from "./polymarket.ts";

test("prefers safe mode whenever the legacy Safe is deployed", () => {
  assert.equal(
    resolvePreferredTradingWalletMode({
      storedMode: "deposit",
      legacySafeDeployed: true,
    }),
    "safe"
  );
});

test("uses deposit mode when no legacy Safe is deployed", () => {
  assert.equal(
    resolvePreferredTradingWalletMode({
      storedMode: "safe",
      legacySafeDeployed: false,
    }),
    "deposit"
  );
});

// ── postClobOrderWithRetry ──

const NOT_READY =
  "order manager not ready, please retry (https://clob.polymarket.com/order)";

function makeRetryHarness() {
  const sleeps = [];
  return {
    sleeps,
    options: {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    },
  };
}

test("transient thrown rejection is retried and then succeeds", async () => {
  const { sleeps, options } = makeRetryHarness();
  let calls = 0;
  const response = await postClobOrderWithRetry(() => {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error(NOT_READY));
    return Promise.resolve({ success: true, orderId: "0xabc" });
  }, options);

  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [500]);
  assert.deepEqual(response, { success: true, orderId: "0xabc" });
});

test("transient rejection carried in a resolved body is retried", async () => {
  const { options } = makeRetryHarness();
  let calls = 0;
  const response = await postClobOrderWithRetry(() => {
    calls += 1;
    if (calls === 1) {
      return Promise.resolve({
        error: "order manager not ready, please retry",
      });
    }
    return Promise.resolve({ success: true });
  }, options);

  assert.equal(calls, 2);
  assert.deepEqual(response, { success: true });
});

test("resolved 425 rejection is retried even with an unknown message", async () => {
  const { options } = makeRetryHarness();
  let calls = 0;
  const response = await postClobOrderWithRetry(() => {
    calls += 1;
    if (calls === 1) {
      return Promise.resolve({ status: 425, error: "Request failed" });
    }
    return Promise.resolve({ success: true });
  }, options);

  assert.equal(calls, 2);
  assert.deepEqual(response, { success: true });
});

test("gives up after the delay budget and rethrows the last error", async () => {
  const { sleeps, options } = makeRetryHarness();
  let calls = 0;
  await assert.rejects(
    postClobOrderWithRetry(() => {
      calls += 1;
      return Promise.reject(new Error(NOT_READY));
    }, options),
    (error) => error.message === NOT_READY
  );

  // Default budget: initial attempt + one retry per delay.
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [500, 1000, 2000]);
});

test("exhausted retries return the final rejected body untouched", async () => {
  const { options } = makeRetryHarness();
  const rejected = { error: "order manager not ready, please retry" };
  let calls = 0;
  const response = await postClobOrderWithRetry(() => {
    calls += 1;
    return Promise.resolve(rejected);
  }, options);

  assert.equal(calls, 4);
  assert.equal(response, rejected);
});

test("non-transient rejections are not retried", async () => {
  const { sleeps, options } = makeRetryHarness();
  let calls = 0;
  await assert.rejects(
    postClobOrderWithRetry(() => {
      calls += 1;
      return Promise.reject(
        new Error(
          "not enough balance / allowance (https://clob.polymarket.com/order)"
        )
      );
    }, options),
    /not enough balance/
  );

  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("a 425 Too Early status is transient even without a known message", async () => {
  const tooEarly = new Error("Request failed");
  tooEarly.status = 425;
  assert.equal(isTransientClobPostOrderError(tooEarly), true);
  assert.equal(
    isTransientClobPostOrderError(new Error("Request failed")),
    false
  );
  assert.equal(isTransientClobPostOrderError(NOT_READY), true);
  assert.equal(isTransientClobPostOrderError("Service is not ready"), true);
  assert.equal(
    isTransientClobPostOrderError(new Error("order timed out")),
    false
  );
});
