// Mutation testing of @mandi/numeric (document 09, section 5.5): target at least 85% of mutants killed.
// Run: npm run mutation:numeric        (slow: minutes; part of the nightly stage, not the commit stage)
// MUTATE_FILES (comma separated, paths under packages/numeric/src) and MUTATION_REPORT let a run be split into
// slices when one long run is not possible (for example in a short-lived build workspace).
const only = process.env.MUTATE_FILES?.split(",").map((f) => `packages/numeric/src/${f}`);

export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.mutation.numeric.config.ts" },
  mutate: only ?? ["packages/numeric/src/**/*.ts", "!packages/numeric/src/**/*.test.ts", "!packages/numeric/src/index.ts"],
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: process.env.MUTATION_REPORT ?? "build-output/mutation/numeric.json" },
  thresholds: { high: 90, low: 85, break: 85 },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
  timeoutMS: Number(process.env.MUTATION_TIMEOUT_MS ?? 60000),
  concurrency: 1,
  ignorePatterns: ["reference", "planning", "build-output", "node_modules", ".git"],
};
