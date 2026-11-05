import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import mandi from "./tools/lint-rules/index.mjs";

/** The two files that may read the real clock and the real random source (TR-1, TR-2). */
const REAL_TIME_AND_RANDOM = ["packages/core/src/runtime/system-clock.ts", "packages/core/src/runtime/system-random.ts"];

/** Engine-side packages: whole numbers only, no exceptions. */
const ENGINE_PACKAGES = ["numeric", "core", "data", "sync", "server", "testkit"];
/** Screen-side packages: layout code may use fractions in literals, money never does. */
const SCREEN_PACKAGES = ["ui", "shell", "android"];

const srcOf = (pkgs) => pkgs.map((p) => `packages/${p}/src/**/*.{ts,tsx}`);

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "reference/**", // RU-1: read-only reference, never built, linted, tested or shipped
      "planning/**",
      "build/**",
      "testing/**",
      "outputs/**",
      "build-output/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },

  // Plain JavaScript: the tools, this file and other root scripts.
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node } },
  },

  // TypeScript everywhere, with type information.
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({ ...c, files: ["**/*.{ts,tsx}"] })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },

  // The product's own rules (document 05 sections 10 and 12; document 08 SEC-5; document 09 TR-1, TR-2, TR-9).
  {
    files: srcOf([...ENGINE_PACKAGES, ...SCREEN_PACKAGES]),
    plugins: { mandi },
    rules: {
      "mandi/no-raw-sql": "error",
      "mandi/company-context": "error",
      "mandi/no-ambient-time-random": ["error", { allowFiles: REAL_TIME_AND_RANDOM }],
    },
  },
  {
    files: srcOf(ENGINE_PACKAGES),
    plugins: { mandi },
    rules: { "mandi/no-floating-point": ["error", { literals: true, division: true }] },
  },
  {
    files: srcOf(SCREEN_PACKAGES),
    plugins: { mandi },
    rules: {
      "mandi/no-floating-point": ["error", { literals: false, division: false }],
      // Screens, the shell and the Android shell may use timers (focus, debounce); the engine may not.
      "mandi/no-ambient-time-random": ["error", { allowFiles: REAL_TIME_AND_RANDOM, timers: false }],
    },
  },
  {
    files: srcOf(["ui", "shell"]),
    plugins: { mandi },
    rules: { "mandi/test-hook": "error" },
  },
  // Tests may use timers (fake-timer tests, waits); they still may not read the real clock or randomness.
  {
    files: ["packages/**/*.test.{ts,tsx}"],
    plugins: { mandi },
    rules: { "mandi/no-ambient-time-random": ["error", { allowFiles: REAL_TIME_AND_RANDOM, timers: false }] },
  },
);
