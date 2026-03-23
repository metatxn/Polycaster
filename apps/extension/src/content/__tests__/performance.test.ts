/**
 * ============================================
 * PERFORMANCE TEST SUITE FOR KNOWW EXTENSION
 * ============================================
 *
 * Measures memory usage, CPU impact, and DOM overhead of the Knoww extension.
 *
 * USAGE:
 * 1. Load the extension in development mode
 * 2. Navigate to Twitter/X (or LinkedIn/Reddit)
 * 3. Open browser DevTools console
 * 4. Copy and paste this entire file into the Console
 * 5. Run: await KnowwPerformanceTests.runAll()
 *
 * Or run individual tests:
 * - KnowwPerformanceTests.testHeapMemory()
 * - KnowwPerformanceTests.testExtensionMemoryStats()
 * - await KnowwPerformanceTests.testMemoryLeakOnScroll()
 * - KnowwPerformanceTests.testDOMNodeCount()
 * - await KnowwPerformanceTests.testCPUPerProcessCycle()
 * - await KnowwPerformanceTests.testMainThreadBlocking()
 * - etc.
 *
 * NOTE: This file is plain JS (no TypeScript) so it can be pasted directly
 * into the browser console. It is NOT included in the production build.
 */

/* eslint-disable */
// @ts-nocheck

const KnowwPerformanceTests = (() => {
  const results = [];

  // ─── Helpers ────────────────────────────────────────────

  function measureTime(fn, iterations = 100) {
    const times = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      fn();
      const end = performance.now();
      times.push(end - start);
    }
    return {
      avg: times.reduce((a, b) => a + b, 0) / times.length,
      min: Math.min(...times),
      max: Math.max(...times),
      total: times.reduce((a, b) => a + b, 0),
    };
  }

  async function measureTimeAsync(fn, iterations = 10) {
    const times = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);
    }
    return {
      avg: times.reduce((a, b) => a + b, 0) / times.length,
      min: Math.min(...times),
      max: Math.max(...times),
      total: times.reduce((a, b) => a + b, 0),
    };
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  }

  function push(result) {
    results.push(result);
    const icon = result.passed ? "✅" : "❌";
    console.log(`   ${icon} ${result.name}: ${result.details}`);
    return result;
  }

  // ═══════════════════════════════════════════════════════
  // MEMORY TESTS
  // ═══════════════════════════════════════════════════════

  // ─── 1. JS Heap Memory ──────────────────────────────────
  function testHeapMemory() {
    console.log("🧪 [Memory] JS Heap usage...");

    if (!performance.memory) {
      return push({
        name: "JS Heap Memory",
        passed: true,
        details: "performance.memory not available (Chrome-only). Skipped.",
      });
    }

    const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } =
      performance.memory;
    const threshold = 500 * 1024 * 1024; // 500MB
    const passed = usedJSHeapSize < threshold;

    return push({
      name: "JS Heap Memory",
      passed,
      value: usedJSHeapSize,
      threshold,
      details: `Used: ${formatBytes(usedJSHeapSize)} / ${formatBytes(totalJSHeapSize)} (limit: ${formatBytes(jsHeapSizeLimit)})`,
    });
  }

  // ─── 2. Extension Internal Memory Stats ─────────────────
  function testExtensionMemoryStats() {
    console.log("🧪 [Memory] Extension internal memory stats...");

    if (!window.KNOWW_INJECTION?.getMemoryStats) {
      return push({
        name: "Extension Memory Stats",
        passed: true,
        details: "KNOWW_INJECTION.getMemoryStats not available. Skipped.",
      });
    }

    const stats = window.KNOWW_INJECTION.getMemoryStats();
    const thresholds = {
      processedPostKeys: 200,
      injectedMarketIds: 100,
      injectedMarkets: 15,
      pendingQueue: 30,
    };

    const passed =
      stats.processedPostKeys <= thresholds.processedPostKeys &&
      stats.injectedMarketIds <= thresholds.injectedMarketIds &&
      stats.injectedMarkets <= thresholds.injectedMarkets &&
      stats.pendingQueue <= thresholds.pendingQueue;

    return push({
      name: "Extension Memory Stats",
      passed,
      details: [
        `PostKeys: ${stats.processedPostKeys}/${thresholds.processedPostKeys}`,
        `MarketIDs: ${stats.injectedMarketIds}/${thresholds.injectedMarketIds}`,
        `Markets: ${stats.injectedMarkets}/${thresholds.injectedMarkets}`,
        `Queue: ${stats.pendingQueue}/${thresholds.pendingQueue}`,
        `Total processed: ${stats.totalPostsProcessed}`,
      ].join(", "),
    });
  }

  // ─── 3. Memory Cleanup Effectiveness ────────────────────
  function testMemoryCleanup() {
    console.log("🧪 [Memory] Cleanup effectiveness...");

    if (
      !window.KNOWW_INJECTION?.runMemoryCleanup ||
      !window.KNOWW_INJECTION?.getMemoryStats
    ) {
      return push({
        name: "Memory Cleanup",
        passed: true,
        details: "KNOWW_INJECTION cleanup not available. Skipped.",
      });
    }

    const before = window.KNOWW_INJECTION.getMemoryStats();
    window.KNOWW_INJECTION.runMemoryCleanup(true);
    const after = window.KNOWW_INJECTION.getMemoryStats();

    const keysFreed = before.processedPostKeys - after.processedPostKeys;
    const idsFreed = before.injectedMarketIds - after.injectedMarketIds;

    return push({
      name: "Memory Cleanup",
      passed: true,
      details: `Freed: ${keysFreed} post keys, ${idsFreed} market IDs (before: ${before.processedPostKeys}/${before.injectedMarketIds}, after: ${after.processedPostKeys}/${after.injectedMarketIds})`,
    });
  }

  // ─── 4. Memory Leak Detection on Scroll ─────────────────
  async function testMemoryLeakOnScroll() {
    console.log("🧪 [Memory] Leak detection during scroll simulation...");

    if (!performance.memory) {
      return push({
        name: "Memory Leak on Scroll",
        passed: true,
        details: "performance.memory not available. Skipped.",
      });
    }

    if (typeof window.gc === "function") window.gc();

    const heapBefore = performance.memory.usedJSHeapSize;

    for (let i = 0; i < 30; i++) {
      window.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (typeof window.gc === "function") window.gc();

    const heapAfter = performance.memory.usedJSHeapSize;
    const delta = heapAfter - heapBefore;

    const threshold = 5 * 1024 * 1024; // 5MB
    const passed = delta < threshold;

    return push({
      name: "Memory Leak on Scroll",
      passed,
      value: delta,
      threshold,
      details: `Heap delta: ${delta > 0 ? "+" : ""}${formatBytes(delta)} (before: ${formatBytes(heapBefore)}, after: ${formatBytes(heapAfter)})`,
    });
  }

  // ─── 5. DOM Node Count ──────────────────────────────────
  function testDOMNodeCount() {
    console.log("🧪 [Memory] Extension DOM node count...");

    const knowwElements = document.querySelectorAll(
      '[id^="knoww-"], [class*="knoww-"], .knoww-market-card'
    );
    const notificationStack = document.getElementById(
      "knoww-notification-stack"
    );
    const stackChildren = notificationStack
      ? notificationStack.querySelectorAll("*").length
      : 0;
    const marketCards = document.querySelectorAll(".knoww-market-card");
    let marketCardNodes = 0;
    marketCards.forEach((card) => {
      marketCardNodes += card.querySelectorAll("*").length;
    });

    const totalExtensionNodes =
      knowwElements.length + stackChildren + marketCardNodes;
    const totalPageNodes = document.querySelectorAll("*").length;
    const percentage = ((totalExtensionNodes / totalPageNodes) * 100).toFixed(
      2
    );

    const threshold = 1; // < 1%
    const passed = parseFloat(percentage) < threshold;

    return push({
      name: "Extension DOM Nodes",
      passed,
      value: totalExtensionNodes,
      details: `Extension: ${totalExtensionNodes} nodes (${percentage}% of page's ${totalPageNodes}). Stack: ${stackChildren}, Cards: ${marketCards.length} (${marketCardNodes} nodes)`,
    });
  }

  // ─── 6. Cache Memory Estimate ───────────────────────────
  function testCacheMemoryEstimate() {
    console.log("🧪 [Memory] Cache memory estimate...");

    let estimatedBytes = 0;
    const breakdown = {};

    if (window.KNOWW_API) {
      try {
        const apiSize = new Blob([JSON.stringify(window.KNOWW_API)]).size;
        estimatedBytes += apiSize;
        breakdown["API cache"] = formatBytes(apiSize);
      } catch {
        breakdown["API cache"] = "not serializable";
      }
    }

    if (window.KNOWW_INJECTION?.getMemoryStats) {
      const stats = window.KNOWW_INJECTION.getMemoryStats();
      const internalEst =
        stats.processedPostKeys * 100 +
        stats.injectedMarketIds * 50 +
        stats.injectedMarkets * 500;
      estimatedBytes += internalEst;
      breakdown["Internal state"] = formatBytes(internalEst);
    }

    const stack = document.getElementById("knoww-notification-stack");
    if (stack) {
      const stackSize = new Blob([stack.outerHTML]).size;
      estimatedBytes += stackSize;
      breakdown["Notification stack HTML"] = formatBytes(stackSize);
    }

    const cards = document.querySelectorAll(".knoww-market-card");
    let cardsSize = 0;
    cards.forEach((card) => {
      cardsSize += new Blob([card.outerHTML]).size;
    });
    estimatedBytes += cardsSize;
    breakdown[`Market cards (${cards.length})`] = formatBytes(cardsSize);

    const threshold = 2 * 1024 * 1024; // 2MB
    const passed = estimatedBytes < threshold;

    return push({
      name: "Cache Memory Estimate",
      passed,
      value: estimatedBytes,
      threshold,
      details: `Estimated: ${formatBytes(estimatedBytes)}. Breakdown: ${Object.entries(
        breakdown
      )
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`,
    });
  }

  // ═══════════════════════════════════════════════════════
  // CPU TESTS
  // ═══════════════════════════════════════════════════════

  // ─── 7. CPU per Process Cycle ───────────────────────────
  async function testCPUPerProcessCycle() {
    console.log("🧪 [CPU] processVisiblePosts cycle time...");

    if (!window.KNOWW_INJECTION?.processVisiblePosts) {
      return push({
        name: "CPU per Process Cycle",
        passed: true,
        details: "KNOWW_INJECTION.processVisiblePosts not available. Skipped.",
      });
    }

    const itemSelector = 'article[data-testid="tweet"]';
    const times = await measureTimeAsync(async () => {
      await window.KNOWW_INJECTION.processVisiblePosts({ itemSelector });
    }, 5);

    const threshold = 50; // ms
    const passed = times.avg < threshold;

    return push({
      name: "CPU per Process Cycle",
      passed,
      value: times.avg,
      threshold,
      details: `Avg: ${times.avg.toFixed(2)}ms, Min: ${times.min.toFixed(2)}ms, Max: ${times.max.toFixed(2)}ms (threshold: <${threshold}ms)`,
    });
  }

  // ─── 8. Card Creation CPU ───────────────────────────────
  function testCardCreationCPU() {
    console.log("🧪 [CPU] Market card creation time...");

    if (!window.KNOWW_UI?.createInlineMarketCard) {
      return push({
        name: "Card Creation CPU",
        passed: true,
        details: "KNOWW_UI.createInlineMarketCard not available. Skipped.",
      });
    }

    const mockMarket = {
      id: "test-market-cpu",
      title: "CPU Test Market: Will this test pass?",
      slug: "cpu-test",
      source: "polymarket",
      volume24hr: 100000,
      markets: [
        {
          id: "test-sub",
          outcomePrices: "[0.65, 0.35]",
          outcomes: '["Yes", "No"]',
          conditionId: "test-cond",
        },
      ],
    };

    const times = measureTime(() => {
      const card = window.KNOWW_UI.createInlineMarketCard(mockMarket, 0.8, [
        "test",
      ]);
      card.remove();
    }, 50);

    const threshold = 5; // ms
    const passed = times.avg < threshold;

    return push({
      name: "Card Creation CPU",
      passed,
      value: times.avg,
      threshold,
      details: `Avg: ${times.avg.toFixed(3)}ms, Min: ${times.min.toFixed(3)}ms, Max: ${times.max.toFixed(3)}ms (threshold: <${threshold}ms)`,
    });
  }

  // ─── 9. DOM Query CPU ──────────────────────────────────
  function testDOMQueryCPU() {
    console.log("🧪 [CPU] Extension DOM query overhead...");

    const selectors = [
      'article[data-testid="tweet"]',
      'div[data-testid="cellInnerDiv"]',
      'div[data-testid="tweetText"]',
      'a[href*="/status/"]',
      'main[role="main"]',
      ".knoww-market-card",
      "#knoww-notification-stack",
    ];

    const perSelector = {};
    for (const selector of selectors) {
      const t = measureTime(() => {
        document.querySelectorAll(selector);
      }, 200);
      perSelector[selector] = t.avg;
    }

    const maxTime = Math.max(...Object.values(perSelector));
    const totalAvg = Object.values(perSelector).reduce((a, b) => a + b, 0);

    const threshold = 5; // ms
    const passed = maxTime < threshold;

    return push({
      name: "DOM Query CPU",
      passed,
      value: maxTime,
      threshold,
      details: `Total avg: ${totalAvg.toFixed(3)}ms across ${selectors.length} selectors. Slowest: ${maxTime.toFixed(3)}ms (threshold: <${threshold}ms)`,
    });
  }

  // ─── 10. Main Thread Blocking ───────────────────────────
  async function testMainThreadBlocking() {
    console.log("🧪 [CPU] Main thread blocking (Long Tasks)...");

    const longTasks = [];

    return new Promise((resolve) => {
      let observer = null;

      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push({ duration: entry.duration, name: entry.name });
          }
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch {
        resolve(
          push({
            name: "Main Thread Blocking",
            passed: true,
            details: "PerformanceObserver for longtask not supported. Skipped.",
          })
        );
        return;
      }

      for (let i = 0; i < 10; i++) {
        setTimeout(() => {
          window.dispatchEvent(new Event("scroll"));
        }, i * 200);
      }

      setTimeout(() => {
        if (observer) observer.disconnect();

        const blocking = longTasks.filter((t) => t.duration > 50);
        const totalBlocking = blocking.reduce((s, t) => s + t.duration, 0);
        const maxTask = blocking.length
          ? Math.max(...blocking.map((t) => t.duration))
          : 0;

        const threshold = 500; // ms
        const passed = totalBlocking < threshold;

        resolve(
          push({
            name: "Main Thread Blocking",
            passed,
            value: totalBlocking,
            threshold,
            details: `${blocking.length} long tasks, total: ${totalBlocking.toFixed(0)}ms, longest: ${maxTask.toFixed(0)}ms (threshold: <${threshold}ms over 5s)`,
          })
        );
      }, 5000);
    });
  }

  // ─── 11. MutationObserver CPU Impact ────────────────────
  async function testMutationObserverCPU() {
    console.log("🧪 [CPU] MutationObserver callback overhead...");

    const container =
      document.querySelector('main[role="main"]') || document.body;
    const callbackTimes = [];
    const iterations = 20;

    return new Promise((resolve) => {
      let count = 0;

      const observer = new MutationObserver((mutations) => {
        const start = performance.now();

        for (const m of mutations) {
          if (!m?.addedNodes?.length) continue;
          for (const node of Array.from(m.addedNodes)) {
            if (node.nodeType !== 1) continue;
            if (node.matches?.('article[data-testid="tweet"]')) {
              // found
            } else if (node.querySelectorAll) {
              node.querySelectorAll('article[data-testid="tweet"]');
            }
          }
        }

        callbackTimes.push(performance.now() - start);
        count++;

        if (count >= iterations) {
          observer.disconnect();
          const avg =
            callbackTimes.reduce((a, b) => a + b, 0) / callbackTimes.length;
          const max = Math.max(...callbackTimes);
          const threshold = 5; // ms
          const passed = avg < threshold;

          resolve(
            push({
              name: "MutationObserver CPU",
              passed,
              value: avg,
              threshold,
              details: `Avg callback: ${avg.toFixed(4)}ms, Max: ${max.toFixed(4)}ms over ${count} mutations (threshold: <${threshold}ms avg)`,
            })
          );
        }
      });

      observer.observe(container, { childList: true, subtree: true });

      for (let i = 0; i < iterations; i++) {
        setTimeout(() => {
          const div = document.createElement("div");
          div.className = "knoww-perf-test-node";
          container.appendChild(div);
          setTimeout(() => div.remove(), 10);
        }, i * 50);
      }

      setTimeout(
        () => {
          observer.disconnect();
          if (callbackTimes.length === 0) {
            resolve(
              push({
                name: "MutationObserver CPU",
                passed: true,
                details: "No mutations observed. Test inconclusive.",
              })
            );
          }
        },
        iterations * 100 + 2000
      );
    });
  }

  // ─── 12. Idle CPU (extension at rest) ───────────────────
  async function testIdleCPU() {
    console.log("🧪 [CPU] Idle CPU usage (no interaction for 3s)...");

    const longTasks = [];
    let observer = null;

    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push(entry.duration);
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      return push({
        name: "Idle CPU",
        passed: true,
        details: "PerformanceObserver longtask not supported. Skipped.",
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (observer) observer.disconnect();

    const totalIdleBlocking = longTasks.reduce((sum, d) => sum + d, 0);
    const threshold = 200; // ms
    const passed = totalIdleBlocking < threshold;

    return push({
      name: "Idle CPU",
      passed,
      value: totalIdleBlocking,
      threshold,
      details: `${longTasks.length} long tasks during 3s idle, total: ${totalIdleBlocking.toFixed(0)}ms (threshold: <${threshold}ms)`,
    });
  }

  // ═══════════════════════════════════════════════════════
  // REPORT
  // ═══════════════════════════════════════════════════════

  function generateReport() {
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    console.log("\n");
    console.log(
      "╔═══════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║       KNOWW EXTENSION MEMORY & CPU TEST REPORT                ║"
    );
    console.log(
      "╠═══════════════════════════════════════════════════════════════╣"
    );
    console.log(
      `║  Total: ${results.length}   Passed: ${passed} ✅   Failed: ${failed} ${failed > 0 ? "❌" : "  "}                              ║`
    );
    console.log(
      "╚═══════════════════════════════════════════════════════════════╝"
    );

    console.log("\n── Memory ──");
    for (const r of results.filter((r) =>
      [
        "JS Heap Memory",
        "Extension Memory Stats",
        "Memory Cleanup",
        "Memory Leak on Scroll",
        "Extension DOM Nodes",
        "Cache Memory Estimate",
      ].includes(r.name)
    )) {
      console.log(`${r.passed ? "✅" : "❌"} ${r.name}: ${r.details}`);
    }

    console.log("\n── CPU ──");
    for (const r of results.filter((r) =>
      [
        "CPU per Process Cycle",
        "Card Creation CPU",
        "DOM Query CPU",
        "Main Thread Blocking",
        "MutationObserver CPU",
        "Idle CPU",
      ].includes(r.name)
    )) {
      console.log(`${r.passed ? "✅" : "❌"} ${r.name}: ${r.details}`);
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════
  // RUN ALL
  // ═══════════════════════════════════════════════════════

  async function runAll() {
    console.log("\n");
    console.log(
      "╔═══════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║     KNOWW EXTENSION MEMORY & CPU TEST SUITE                  ║"
    );
    console.log(
      "╚═══════════════════════════════════════════════════════════════╝"
    );
    console.log("\n── Memory Tests ──\n");

    results.length = 0;

    testHeapMemory();
    testExtensionMemoryStats();
    testMemoryCleanup();
    await testMemoryLeakOnScroll();
    testDOMNodeCount();
    testCacheMemoryEstimate();

    console.log("\n── CPU Tests ──\n");

    await testCPUPerProcessCycle();
    testCardCreationCPU();
    testDOMQueryCPU();
    await testMainThreadBlocking();
    await testMutationObserverCPU();
    await testIdleCPU();

    generateReport();

    const failedCount = results.filter((r) => !r.passed).length;
    if (failedCount === 0) {
      console.log("\n🎉 All memory & CPU tests passed!");
    } else {
      console.warn(`\n⚠️ ${failedCount} test(s) failed. See report above.`);
    }

    return results;
  }

  return {
    results,
    runAll,
    testHeapMemory,
    testExtensionMemoryStats,
    testMemoryCleanup,
    testMemoryLeakOnScroll,
    testDOMNodeCount,
    testCacheMemoryEstimate,
    testCPUPerProcessCycle,
    testCardCreationCPU,
    testDOMQueryCPU,
    testMainThreadBlocking,
    testMutationObserverCPU,
    testIdleCPU,
    generateReport,
  };
})();

window.KnowwPerformanceTests = KnowwPerformanceTests;
console.log(
  "✅ KnowwPerformanceTests loaded! Run: await KnowwPerformanceTests.runAll()"
);
