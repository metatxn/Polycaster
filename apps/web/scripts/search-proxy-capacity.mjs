#!/usr/bin/env node

import {
  parseCapacityOptions,
  runCapacityScenario,
  validateCapacityTarget,
} from "../src/lib/search-proxy-capacity.mjs";

const USAGE = `Usage: pnpm --filter @knoww/web capacity:search [options]

Runs a bounded synthetic capacity check against /api/search.

Options:
  --base-url URL                Target origin (default: http://127.0.0.1:8000)
  --tabs N                      Simulated tabs, 1-8 (default: 1)
  --requests-per-tab N          Requests per tab, 1-100 (default: 10)
  --interval-ms N               Delay between requests per tab (default: 900)
  --limit N                     Search result limit, 1-100 (default: 8)
  --timeout-ms N                Per-request timeout (default: 5000)
  --cache-mode hit|miss|mixed   Query reuse pattern (default: mixed)
  --recovery-probes N           Post-load health probes, 0-120 (default: 5)
  --recovery-interval-ms N      Delay between recovery probes (default: 1000)
  --allow-remote                Required for any non-localhost target
  --help                        Show this help
`;

try {
  const options = parseCapacityOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
  } else {
    validateCapacityTarget(options);
    const report = await runCapacityScenario(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Capacity check failed";
  process.stderr.write(`${message}\n\n${USAGE}`);
  process.exitCode = 1;
}
