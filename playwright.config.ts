import { defineConfig } from "@playwright/test";

/**
 * Screen tests (document 09, section 4.1). Chromium is the same engine as the Electron shell and the
 * Android WebView, so Urdu shaping matches. Controls are found by stable test hooks (TR-9), never
 * by text or position. No automatic retries: a flaky test is a defect to fix, not to hide (15.6).
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  retries: 0,
  ...(process.env["CI"] ? { workers: 2 } : {}),
  reporter: [["list"], ["json", { outputFile: "build-output/e2e-report.json" }]],
  use: {
    testIdAttribute: "data-testid", // docs/CONVENTIONS.md: <screen-or-area>.<part>.<name>
    reducedMotion: "reduce", // test mode: animations off (TR-9)
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
