import { defineConfig } from "vitest/config";

/** The numeric package's tests alone, for the mutation run (Stryker re-runs these once per mutant). */
export default defineConfig({
  test: {
    globals: false,
    include: ["packages/numeric/src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tools/ci/vitest-setup.mjs"],
  },
});
