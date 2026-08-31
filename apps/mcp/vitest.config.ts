import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // The pool loads the top-level wrangler.jsonc environment, so tests
      // see the production-shaped vars (oauth-required) by default.
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          GOOGLE_CLIENT_ID: "google-test-client.apps.googleusercontent.com",
          GOOGLE_CLIENT_SECRET: "google-test-secret",
        },
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    // Durable Object startup can exceed Vitest's 5-second default when all
    // Workers suites initialize concurrently on a cold CI runner.
    testTimeout: 10_000,
  },
});
