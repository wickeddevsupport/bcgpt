import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || "https://os.wickedlab.io";

export default defineConfig({
  testDir: "./tests/playwright",
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
