import { defineConfig } from "vitest/config";

/** Every workspace package is its own Vitest project; `tools` holds the tests of the build tooling itself. */
const PACKAGES = ["numeric", "core", "data", "sync", "server", "shell", "ui", "android", "testkit"];

export default defineConfig({
  test: {
    globals: false,
    globalSetup: ["./tools/ci/vitest-global-setup.mjs"],
    projects: [
      ...PACKAGES.map((name) => ({
        extends: true as const,
        test: {
          name,
          include: [`packages/${name}/src/**/*.test.ts`],
          environment: "node" as const,
          setupFiles: ["./tools/ci/vitest-setup.mjs"],
        },
      })),
      {
        extends: true as const,
        test: {
          name: "tools",
          include: ["tools/**/*.test.mjs"],
          environment: "node" as const,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
    passWithNoTests: true,
    coverage: { provider: "v8", reporter: ["text-summary", "json-summary"], reportsDirectory: "build-output/coverage" },
  },
});
