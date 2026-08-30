import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCapacityOptions,
  runCapacityScenario,
  summarizeCapacityResults,
  validateCapacityTarget,
} from "./search-proxy-capacity.mjs";

test("capacity target defaults to localhost and rejects remote hosts", () => {
  const options = parseCapacityOptions([]);
  assert.equal(options.baseUrl, "http://127.0.0.1:8000");
  assert.doesNotThrow(() => validateCapacityTarget(options));
  assert.throws(
    () =>
      validateCapacityTarget({
        ...options,
        baseUrl: "https://knoww.app",
      }),
    /requires --allow-remote/
  );
  assert.doesNotThrow(() =>
    validateCapacityTarget({
      ...options,
      baseUrl: "https://staging.example.com",
      allowRemote: true,
    })
  );
});

test("capacity options reject unbounded load settings", () => {
  assert.throws(() => parseCapacityOptions(["--tabs", "9"]), /tabs/);
  assert.throws(
    () => parseCapacityOptions(["--requests-per-tab", "0"]),
    /requests-per-tab/
  );
  assert.throws(
    () => parseCapacityOptions(["--timeout-ms", "120001"]),
    /timeout-ms/
  );
  assert.throws(() => parseCapacityOptions(["--tabs", "2tabs"]), /tabs/);
  assert.throws(
    () =>
      parseCapacityOptions([
        "--requests-per-tab",
        "100",
        "--interval-ms",
        "60000",
      ]),
    /estimated maximum runtime/
  );
});

test("capacity summary separates transport and response failure classes", () => {
  const summary = summarizeCapacityResults(
    [
      {
        tab: 1,
        latencyMs: 500,
        status: null,
        degraded: false,
        empty: true,
        cacheState: "NONE",
        error: "timeout",
      },
      {
        tab: 1,
        latencyMs: 100,
        status: 200,
        degraded: false,
        empty: true,
        cacheState: "MISS",
        error: "invalid_json",
      },
      {
        tab: 1,
        latencyMs: 50,
        status: null,
        degraded: false,
        empty: true,
        cacheState: "NONE",
        error: "network_error",
      },
    ],
    1_000
  );

  assert.deepEqual(summary.outcomes, {
    timeout: 1,
    invalid_response: 1,
    network_error: 1,
  });
});

test("capacity summary reports percentiles and failure classes", () => {
  const summary = summarizeCapacityResults(
    [
      {
        tab: 1,
        latencyMs: 100,
        status: 200,
        degraded: false,
        empty: false,
        cacheState: "MISS",
      },
      {
        tab: 1,
        latencyMs: 200,
        status: 200,
        degraded: false,
        empty: true,
        cacheState: "HIT",
      },
      {
        tab: 2,
        latencyMs: 300,
        status: 502,
        degraded: true,
        empty: true,
        cacheState: "MISS",
      },
      {
        tab: 2,
        latencyMs: 400,
        status: 429,
        degraded: false,
        empty: true,
        cacheState: "NONE",
      },
      {
        tab: 2,
        latencyMs: 500,
        status: null,
        degraded: false,
        empty: true,
        cacheState: "NONE",
        error: "timeout",
      },
    ],
    1_000
  );

  assert.deepEqual(summary.latencyMs, {
    p50: 300,
    p95: 500,
    p99: 500,
    max: 500,
  });
  assert.deepEqual(summary.statuses, {
    200: 2,
    429: 1,
    502: 1,
    network_error: 1,
  });
  assert.deepEqual(summary.outcomes, {
    success: 1,
    empty: 1,
    degraded_empty: 1,
    rate_limited: 1,
    timeout: 1,
  });
  assert.deepEqual(summary.cacheStates, {
    HIT: 1,
    MISS: 2,
    NONE: 2,
  });
  assert.equal(summary.requests, 5);
  assert.equal(summary.throughputPerSecond, 5);
  assert.equal(JSON.stringify(summary).includes("query"), false);
});

test("capacity scenario simulates tabs and reports recovery probes", async () => {
  const options = parseCapacityOptions([
    "--tabs",
    "2",
    "--requests-per-tab",
    "2",
    "--interval-ms",
    "0",
    "--limit",
    "20",
    "--recovery-probes",
    "2",
    "--recovery-interval-ms",
    "100",
  ]);
  const urls = [];
  const responses = [
    () => Response.json({ events: [{ id: "event" }] }, { status: 200 }),
    () =>
      Response.json(
        { degraded: true, events: [] },
        { status: 502, headers: { "X-Knoww-Search-Degraded": "true" } }
      ),
    () => Response.json({ error: "limited" }, { status: 429 }),
    () => {
      throw new TypeError("network down");
    },
    () => Response.json({ error: "limited" }, { status: 429 }),
    () => Response.json({ events: [{ id: "recovered" }] }, { status: 200 }),
  ];
  let clock = 0;

  const report = await runCapacityScenario(options, {
    fetchImpl: async (url) => {
      urls.push(String(url));
      return responses.shift()();
    },
    now: () => clock,
    sleep: async (durationMs) => {
      clock += durationMs;
    },
  });

  assert.equal(urls.length, 6);
  assert.equal(
    urls.every((url) => url.includes("limit=20")),
    true
  );
  assert.equal(
    urls.every((url) => url.includes("source=extension")),
    true
  );
  assert.equal(report.load.requests, 4);
  assert.equal(report.recovery.needed, true);
  assert.equal(report.recovery.attempts, 2);
  assert.equal(report.recovery.recovered, true);
  assert.equal(JSON.stringify(report).includes("network down"), false);
  assert.equal(JSON.stringify(report).includes("q="), false);
});

test("capacity scenario skips recovery probes after a healthy load", async () => {
  const options = parseCapacityOptions([
    "--requests-per-tab",
    "2",
    "--interval-ms",
    "0",
    "--recovery-probes",
    "3",
  ]);
  let requests = 0;

  const report = await runCapacityScenario(options, {
    fetchImpl: async () => {
      requests++;
      return Response.json({ events: [{ id: "event" }] }, { status: 200 });
    },
    now: () => 0,
    sleep: async () => {},
  });

  assert.equal(requests, 2);
  assert.deepEqual(report.recovery, {
    needed: false,
    attempts: 0,
    recovered: null,
    recoveryMs: null,
    probes: {
      requests: 0,
      elapsedMs: 0,
      throughputPerSecond: 0,
      latencyMs: { p50: null, p95: null, p99: null, max: null },
      statuses: {},
      outcomes: {},
      cacheStates: {},
    },
  });
});
