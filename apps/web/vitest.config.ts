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
      include: [
        "src/hooks/use-clob-client.ts",
        "src/hooks/use-clob-credentials.ts",
        "src/hooks/use-notifications.ts",
      ],
      exclude: ["src/**/*.d.ts", "src/test/**"],
    },
  },
});
