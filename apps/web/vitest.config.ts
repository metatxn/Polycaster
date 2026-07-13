import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx,mts,mtsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx,mts,mtsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/test/**",
        "src/**/*.{test,spec}.{ts,tsx,mts,mtsx}",
        "src/**/__tests__/**",
      ],
      thresholds: {
        statements: 19,
        branches: 14,
        functions: 19,
        lines: 20,
      },
    },
  },
});
