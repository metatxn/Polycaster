import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:8000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @knoww/web dev",
    env: {
      ...process.env,
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
        process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "e2e-project-id",
    },
    url: "http://127.0.0.1:8000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
