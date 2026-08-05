import { defineConfig } from "vitest/config";

export default defineConfig({
  // Webpack DefinePlugin injects `__STORE_BUILD__` at bundle time; tests run
  // raw TS, so define it here. Tests exercise the full (non-store) build,
  // matching production behavior for the trading paths under test. (`__DEV_MODE__`
  // is intentionally left undefined — existing tests stub it themselves.)
  define: {
    __STORE_BUILD__: "false",
  },
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
  },
});
