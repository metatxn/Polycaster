const DEFAULT_OPTIONS = Object.freeze({
  baseUrl: "http://127.0.0.1:8000",
  tabs: 1,
  requestsPerTab: 10,
  intervalMs: 900,
  limit: 8,
  timeoutMs: 5_000,
  recoveryProbes: 5,
  recoveryIntervalMs: 1_000,
  cacheMode: "mixed",
  allowRemote: false,
});
const MAX_ESTIMATED_RUNTIME_MS = 15 * 60 * 1_000;

const BOUNDS = Object.freeze({
  tabs: [1, 8],
  requestsPerTab: [1, 100],
  intervalMs: [0, 60_000],
  limit: [1, 100],
  timeoutMs: [100, 120_000],
  recoveryProbes: [0, 120],
  recoveryIntervalMs: [100, 60_000],
});

const NUMBER_FLAGS = new Map([
  ["--tabs", "tabs"],
  ["--requests-per-tab", "requestsPerTab"],
  ["--interval-ms", "intervalMs"],
  ["--limit", "limit"],
  ["--timeout-ms", "timeoutMs"],
  ["--recovery-probes", "recoveryProbes"],
  ["--recovery-interval-ms", "recoveryIntervalMs"],
]);

function parseBoundedInteger(flag, rawValue, key) {
  const normalizedValue = rawValue ?? "";
  const value = /^\d+$/.test(normalizedValue)
    ? Number.parseInt(normalizedValue, 10)
    : Number.NaN;
  const [minimum, maximum] = BOUNDS[key];
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${flag} must be an integer between ${minimum} and ${maximum}`
    );
  }
  return value;
}

export function parseCapacityOptions(argv) {
  const options = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--allow-remote") {
      options.allowRemote = true;
      continue;
    }
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    if (flag === "--base-url") {
      options.baseUrl = argv[++index] ?? "";
      continue;
    }
    if (flag === "--cache-mode") {
      const cacheMode = argv[++index];
      if (!new Set(["hit", "miss", "mixed"]).has(cacheMode)) {
        throw new Error("--cache-mode must be hit, miss, or mixed");
      }
      options.cacheMode = cacheMode;
      continue;
    }

    const key = NUMBER_FLAGS.get(flag);
    if (!key) throw new Error(`Unknown option: ${flag}`);
    options[key] = parseBoundedInteger(flag, argv[++index], key);
  }

  if (options.tabs * options.requestsPerTab > 500) {
    throw new Error("tabs multiplied by requests-per-tab must not exceed 500");
  }
  const estimatedLoadRuntimeMs =
    options.requestsPerTab * options.timeoutMs +
    Math.max(0, options.requestsPerTab - 1) * options.intervalMs;
  const estimatedRecoveryRuntimeMs =
    options.recoveryProbes * options.timeoutMs +
    Math.max(0, options.recoveryProbes - 1) * options.recoveryIntervalMs;
  options.estimatedMaximumRuntimeMs =
    estimatedLoadRuntimeMs + estimatedRecoveryRuntimeMs;
  if (options.estimatedMaximumRuntimeMs > MAX_ESTIMATED_RUNTIME_MS) {
    throw new Error("estimated maximum runtime must not exceed 15 minutes");
  }
  return options;
}

export function validateCapacityTarget(options) {
  let target;
  try {
    target = new URL(options.baseUrl);
  } catch {
    throw new Error("--base-url must be a valid HTTP or HTTPS URL");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("--base-url must use HTTP or HTTPS");
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (!localHosts.has(target.hostname) && options.allowRemote !== true) {
    throw new Error("A remote capacity target requires --allow-remote");
  }
  return target;
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function classifyResult(result) {
  if (result.error === "timeout") return "timeout";
  if (result.error === "invalid_json") return "invalid_response";
  if (result.error) return "network_error";
  if (result.status === 429) return "rate_limited";
  if (result.degraded && result.empty) return "degraded_empty";
  if (result.degraded) return "degraded";
  if (result.status !== null && result.status >= 500) return "server_error";
  if (result.status !== null && result.status >= 400) return "http_error";
  if (result.empty) return "empty";
  return "success";
}

export function summarizeCapacityResults(results, elapsedMs) {
  const statuses = {};
  const outcomes = {};
  const cacheStates = {};
  const latencyValues = [];

  for (const result of results) {
    increment(
      statuses,
      result.status === null ? "network_error" : String(result.status)
    );
    increment(outcomes, classifyResult(result));
    increment(cacheStates, result.cacheState || "NONE");
    if (Number.isFinite(result.latencyMs)) latencyValues.push(result.latencyMs);
  }

  return {
    requests: results.length,
    elapsedMs,
    throughputPerSecond:
      elapsedMs > 0
        ? Number((results.length / (elapsedMs / 1_000)).toFixed(2))
        : 0,
    latencyMs: {
      p50: percentile(latencyValues, 0.5),
      p95: percentile(latencyValues, 0.95),
      p99: percentile(latencyValues, 0.99),
      max: latencyValues.length > 0 ? Math.max(...latencyValues) : null,
    },
    statuses,
    outcomes,
    cacheStates,
  };
}

const SYNTHETIC_QUERIES = [
  "bitcoin price",
  "federal reserve rates",
  "us presidential election",
  "nba championship",
  "artificial intelligence model",
  "space launch",
];

function queryForRequest(options, tab, requestIndex, phase) {
  const base =
    SYNTHETIC_QUERIES[(tab + requestIndex) % SYNTHETIC_QUERIES.length];
  if (options.cacheMode === "hit") return base;
  if (options.cacheMode === "mixed" && requestIndex % 2 === 0) return base;
  return `${base} capacity ${phase} ${tab} ${requestIndex}`;
}

function buildSearchUrl(target, options, query) {
  const url = new URL("/api/search", target);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("source", "extension");
  return url;
}

function resultIsHealthy(result) {
  return (
    !result.error &&
    result.status !== null &&
    result.status >= 200 &&
    result.status < 300 &&
    !result.degraded
  );
}

async function executeSearchRequest({
  target,
  options,
  tab,
  requestIndex,
  phase,
  fetchImpl,
  now,
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
  const startedAt = now();
  const url = buildSearchUrl(
    target,
    options,
    queryForRequest(options, tab, requestIndex, phase)
  );

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      return {
        tab,
        latencyMs: Math.max(0, now() - startedAt),
        status: response.status,
        degraded: response.headers.get("x-knoww-search-degraded") === "true",
        empty: true,
        cacheState: response.headers.get("x-knoww-search-cache") || "NONE",
        error: "invalid_json",
      };
    }

    const events = Array.isArray(payload?.events)
      ? payload.events
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
    return {
      tab,
      latencyMs: Math.max(0, now() - startedAt),
      status: response.status,
      degraded:
        payload?.degraded === true ||
        response.headers.get("x-knoww-search-degraded") === "true",
      empty: events.length === 0,
      cacheState: response.headers.get("x-knoww-search-cache") || "NONE",
    };
  } catch (error) {
    return {
      tab,
      latencyMs: Math.max(0, now() - startedAt),
      status: null,
      degraded: false,
      empty: true,
      cacheState: "NONE",
      error: error?.name === "AbortError" ? "timeout" : "network_error",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runCapacityScenario(options, dependencies = {}) {
  const target = validateCapacityTarget(options);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => performance.now());
  const sleep =
    dependencies.sleep ??
    ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
  const loadStartedAt = now();

  const perTabResults = await Promise.all(
    Array.from({ length: options.tabs }, async (_, tabIndex) => {
      const tab = tabIndex + 1;
      const results = [];
      for (
        let requestIndex = 0;
        requestIndex < options.requestsPerTab;
        requestIndex++
      ) {
        results.push(
          await executeSearchRequest({
            target,
            options,
            tab,
            requestIndex,
            phase: "load",
            fetchImpl,
            now,
          })
        );
        if (
          requestIndex + 1 < options.requestsPerTab &&
          options.intervalMs > 0
        ) {
          await sleep(options.intervalMs);
        }
      }
      return results;
    })
  );
  const loadResults = perTabResults.flat();
  const loadElapsedMs = Math.max(0, now() - loadStartedAt);

  const recoveryNeeded = loadResults.some((result) => !resultIsHealthy(result));
  const recoveryStartedAt = now();
  const recoveryResults = [];
  if (recoveryNeeded) {
    for (let probe = 0; probe < options.recoveryProbes; probe++) {
      if (probe > 0) await sleep(options.recoveryIntervalMs);
      const result = await executeSearchRequest({
        target,
        options,
        tab: 0,
        requestIndex: probe,
        phase: "recovery",
        fetchImpl,
        now,
      });
      recoveryResults.push(result);
      if (resultIsHealthy(result)) break;
    }
  }
  const recovered = recoveryNeeded
    ? recoveryResults.some(resultIsHealthy)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    targetOrigin: target.origin,
    configuration: {
      tabs: options.tabs,
      requestsPerTab: options.requestsPerTab,
      intervalMs: options.intervalMs,
      limit: options.limit,
      timeoutMs: options.timeoutMs,
      cacheMode: options.cacheMode,
      recoveryProbes: options.recoveryProbes,
      recoveryIntervalMs: options.recoveryIntervalMs,
      estimatedMaximumRuntimeMs: options.estimatedMaximumRuntimeMs,
    },
    load: summarizeCapacityResults(loadResults, loadElapsedMs),
    recovery: {
      needed: recoveryNeeded,
      attempts: recoveryResults.length,
      recovered,
      recoveryMs:
        recoveryNeeded && recovered
          ? Math.max(0, now() - recoveryStartedAt)
          : null,
      probes: summarizeCapacityResults(
        recoveryResults,
        Math.max(0, now() - recoveryStartedAt)
      ),
    },
  };
}
