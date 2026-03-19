import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.SOAK_BASE_URL || "http://127.0.0.1:8787";
const CYCLES_PER_ROUTE = Number.parseInt(
  process.env.SOAK_CYCLES_PER_ROUTE || "30",
  10
);
const STEP_WAIT_MS = Number.parseInt(
  process.env.SOAK_STEP_WAIT_MS || "1200",
  10
);
const NAV_WAIT_MS = Number.parseInt(process.env.SOAK_NAV_WAIT_MS || "3000", 10);
const OUTPUT_PATH =
  process.env.SOAK_OUTPUT_PATH ||
  path.join(process.cwd(), "artifacts", "soak-memory.json");
const ASSERT_MODE = process.env.SOAK_ASSERT === "1";
const WARMUP_CYCLES = Number.parseInt(
  process.env.SOAK_WARMUP_CYCLES || "8",
  10
);

const THRESHOLDS = {
  maxSlopeBytesPerCycle: Number.parseInt(
    process.env.SOAK_MAX_SLOPE_BYTES_PER_CYCLE || "60000",
    10
  ),
  maxDomSlopePerCycle: Number.parseFloat(
    process.env.SOAK_MAX_DOM_SLOPE_PER_CYCLE || "5"
  ),
  maxRuntimeUsedMB: Number.parseFloat(
    process.env.SOAK_MAX_RUNTIME_USED_MB || "200"
  ),
  maxRuntimeDeltaMB: Number.parseFloat(
    process.env.SOAK_MAX_RUNTIME_DELTA_MB || "30"
  ),
  maxDomDelta: Number.parseInt(process.env.SOAK_MAX_DOM_DELTA || "2000", 10),
};

// ── Route definitions ──────────────────────────────────────────────────
// Each route defines a path and an optional interaction function that
// exercises page-specific UI (tab switches, filters, etc.)

const ROUTES = [
  {
    name: "home",
    path: "/",
    interactions: async (page, cycle) => {
      await clickByName(page, /trending/i);
      if (cycle % 3 === 0) await clickByName(page, /new/i);
      if (cycle % 3 === 1) await clickByName(page, /volume/i);
    },
  },
  {
    name: "whales",
    path: "/whales",
    interactions: async (page, cycle) => {
      const sensitivityButtons = [/Conservative/i, /Balanced/i, /Aggressive/i];
      const sortButtons = [
        /Most Suspicious/i,
        /Largest Amount/i,
        /Newest Account/i,
        /Most Repeated/i,
      ];
      const periodButtons = [/24H/i, /7D/i, /30D/i, /^All$/i];
      const minTradeButtons = [/\$100\+/i, /\$500\+/i, /\$1K\+/i, /\$5K\+/i];

      if (cycle % 2 === 0) {
        await clickByName(page, /Insider Detection/i);
        await clickByName(
          page,
          sensitivityButtons[cycle % sensitivityButtons.length]
        );
        await clickByName(page, sortButtons[cycle % sortButtons.length]);
      } else {
        await clickByName(page, /Whale Activity/i);
        await clickByName(page, periodButtons[cycle % periodButtons.length]);
        await clickByName(
          page,
          minTradeButtons[cycle % minTradeButtons.length]
        );
      }
    },
  },
  {
    name: "leaderboard",
    path: "/leaderboard",
    interactions: async (page, cycle) => {
      const tabs = [/volume/i, /profit/i, /markets/i];
      await clickByName(page, tabs[cycle % tabs.length]);
    },
  },
  {
    name: "live",
    path: "/live",
    interactions: async (page, cycle) => {
      await page.evaluate(() => window.scrollBy(0, 400));
      if (cycle % 4 === 0) await page.evaluate(() => window.scrollTo(0, 0));
    },
  },
  {
    name: "search",
    path: "/search",
    interactions: async (page, cycle) => {
      const queries = ["election", "bitcoin", "sports", "crypto", "ai"];
      const input = page.getByRole("textbox").first();
      if (await input.isVisible().catch(() => false)) {
        await input.fill(queries[cycle % queries.length]);
        await page.waitForTimeout(600);
        await input.fill("");
      }
    },
  },
  {
    name: "events-politics",
    path: "/events/politics",
    interactions: async (page, cycle) => {
      await page.evaluate(() => window.scrollBy(0, 300));
      if (cycle % 3 === 0) await page.evaluate(() => window.scrollTo(0, 0));
    },
  },
  {
    name: "notifications",
    path: "/notifications",
    interactions: async (page, cycle) => {
      const tabs = [/all/i, /unread/i];
      await clickByName(page, tabs[cycle % tabs.length]);
    },
  },
];

// ── Utilities ──────────────────────────────────────────────────────────

function compactBytes(bytes) {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function linearSlope(values) {
  if (values.length < 2) return 0;
  const n = values.length;
  const sumX = ((n - 1) * n) / 2;
  const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((acc, y, x) => acc + x * y, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

async function clickByName(page, name) {
  const btn = page.getByRole("button", { name, exact: false }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click({ timeout: 5000 }).catch(() => {});
    return true;
  }
  return false;
}

async function collectSnapshot(cdp, page) {
  const [runtimeHeap, perfMetrics, domInfo] = await Promise.all([
    cdp.send("Runtime.getHeapUsage"),
    cdp.send("Performance.getMetrics"),
    page.evaluate(() => ({
      domNodes: document.getElementsByTagName("*").length,
      perfMemory:
        "memory" in performance
          ? {
              usedJSHeapSize: performance.memory.usedJSHeapSize,
              totalJSHeapSize: performance.memory.totalJSHeapSize,
            }
          : null,
    })),
  ]);

  return {
    ts: Date.now(),
    runtimeUsedSize: runtimeHeap.usedSize,
    runtimeTotalSize: runtimeHeap.totalSize,
    metricJSHeapUsedSize:
      perfMetrics.metrics.find((m) => m.name === "JSHeapUsedSize")?.value ??
      null,
    domNodes: domInfo.domNodes,
    perfMemory: domInfo.perfMemory,
  };
}

function summarizeRoute(routeName, snapshots) {
  const runtimeSeries = snapshots.map((s) => s.runtimeUsedSize);
  const domSeries = snapshots.map((s) => s.domNodes);
  const warmup = Math.min(Math.max(WARMUP_CYCLES, 0), snapshots.length - 2);
  const runtimeSlope = runtimeSeries.slice(warmup);
  const domSlope = domSeries.slice(warmup);

  return {
    route: routeName,
    samples: snapshots.length,
    slopeSamples: runtimeSlope.length,
    runtimeUsedStartMB: compactBytes(runtimeSeries[0] || 0),
    runtimeUsedEndMB: compactBytes(runtimeSeries.at(-1) || 0),
    runtimeUsedMaxMB: compactBytes(Math.max(...runtimeSeries)),
    runtimeUsedDeltaMB: Number(
      (
        compactBytes(runtimeSeries.at(-1) || 0) -
        compactBytes(runtimeSeries[0] || 0)
      ).toFixed(2)
    ),
    runtimeSlopeBytesPerCycle: Math.round(linearSlope(runtimeSlope)),
    domNodesStart: domSeries[0] || 0,
    domNodesEnd: domSeries.at(-1) || 0,
    domNodesMax: Math.max(...domSeries),
    domNodesDelta: (domSeries.at(-1) || 0) - (domSeries[0] || 0),
    domSlopePerCycle: Number(linearSlope(domSlope).toFixed(2)),
  };
}

function evaluateRoute(summary) {
  const checks = [
    {
      id: `${summary.route}/runtime-slope`,
      value: summary.runtimeSlopeBytesPerCycle,
      max: THRESHOLDS.maxSlopeBytesPerCycle,
      minSamples: 15,
      samples: summary.slopeSamples,
    },
    {
      id: `${summary.route}/dom-slope`,
      value: summary.domSlopePerCycle,
      max: THRESHOLDS.maxDomSlopePerCycle,
      minSamples: 15,
      samples: summary.slopeSamples,
    },
    {
      id: `${summary.route}/runtime-max`,
      value: summary.runtimeUsedMaxMB,
      max: THRESHOLDS.maxRuntimeUsedMB,
    },
    {
      id: `${summary.route}/runtime-delta`,
      value: summary.runtimeUsedDeltaMB,
      max: THRESHOLDS.maxRuntimeDeltaMB,
    },
    {
      id: `${summary.route}/dom-delta`,
      value: summary.domNodesDelta,
      max: THRESHOLDS.maxDomDelta,
    },
  ];

  return checks.map((c) => {
    const skipped =
      typeof c.minSamples === "number" &&
      typeof c.samples === "number" &&
      c.samples < c.minSamples;
    return { ...c, skipped, pass: skipped || c.value <= c.max };
  });
}

// ── Main ───────────────────────────────────────────────────────────────

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-precise-memory-info"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 920 },
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Runtime.enable");

  const routeResults = [];

  try {
    for (const route of ROUTES) {
      console.log(`\n── ${route.name} (${route.path}) ──`);
      const snapshots = [];

      await page.goto(`${BASE_URL}${route.path}`, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await page.waitForTimeout(NAV_WAIT_MS);

      for (let i = 0; i < CYCLES_PER_ROUTE; i++) {
        try {
          await route.interactions(page, i);
        } catch {
          // Interaction may fail if UI elements are absent; that's fine
        }

        await page.waitForTimeout(STEP_WAIT_MS);

        if (i % 8 === 0) {
          await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
        }

        const snap = await collectSnapshot(cdp, page);
        snapshots.push({ cycle: i + 1, ...snap });
      }

      const summary = summarizeRoute(route.name, snapshots);
      const checks = evaluateRoute(summary);
      routeResults.push({ summary, checks, snapshots });

      const failed = checks.filter((c) => !c.pass);
      if (failed.length > 0) {
        console.log(`  WARN: ${failed.length} threshold(s) exceeded`);
        for (const f of failed)
          console.log(`    - ${f.id}: ${f.value} > max ${f.max}`);
      } else {
        console.log(
          `  OK  heap: ${summary.runtimeUsedStartMB}→${summary.runtimeUsedEndMB} MB ` +
            `(slope ${summary.runtimeSlopeBytesPerCycle} B/cycle)  ` +
            `DOM: ${summary.domNodesStart}→${summary.domNodesEnd} (slope ${summary.domSlopePerCycle}/cycle)`
        );
      }
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // ── Global summary ─────────────────────────────────────────────────
  const allSnapshots = routeResults.flatMap((r) => r.snapshots);
  const globalSummary = summarizeRoute("global", allSnapshots);
  const globalChecks = evaluateRoute(globalSummary);
  const allChecks = routeResults.flatMap((r) => r.checks).concat(globalChecks);
  const allFailures = allChecks.filter((c) => !c.pass);

  const report = {
    meta: {
      baseUrl: BASE_URL,
      cyclesPerRoute: CYCLES_PER_ROUTE,
      stepWaitMs: STEP_WAIT_MS,
      navWaitMs: NAV_WAIT_MS,
      warmupCycles: WARMUP_CYCLES,
      totalSnapshots: allSnapshots.length,
      routes: ROUTES.map((r) => r.name),
      ts: new Date().toISOString(),
    },
    thresholds: THRESHOLDS,
    globalSummary,
    globalChecks,
    routes: routeResults.map(({ summary, checks }) => ({ summary, checks })),
    assertMode: ASSERT_MODE,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log("\n── Global Summary ──");
  console.log(JSON.stringify(globalSummary, null, 2));
  console.log(`\nreport: ${OUTPUT_PATH}`);

  if (allFailures.length > 0) {
    console.log(`\n${allFailures.length} check(s) exceeded thresholds:`);
    for (const f of allFailures) {
      console.error(`  - ${f.id}: ${f.value} > max ${f.max}`);
    }
    if (ASSERT_MODE) process.exit(2);
  } else {
    console.log("\nAll checks passed.");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
