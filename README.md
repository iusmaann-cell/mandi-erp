# Mandi ERP

Offline-first ERP for general trading companies working in mandi. "Mandi ERP" is a working name (AR-2).
Planning documents live in the Claude Project "Trading ERP for Mandi"; this repository holds the code.

```
npm ci                    # exact versions from package-lock.json; install scripts are off (.npmrc)
npm run check             # typecheck, lint, secret scan, tests, dependency audit (the commit pipeline)
npm run check:offline     # the same without the dependency audit (needs no network)
npm test                  # Vitest, all packages and tools
npm run e2e               # Playwright screen tests (needs: npx playwright install chromium)
npm run sbom              # software bill of materials to build-output/sbom.cdx.json
npm run mutation:numeric  # mutation testing of @mandi/numeric (minutes; nightly, not per commit)
```

Needs Node 22.13 or newer and npm 11.21.1 (`npm install --global npm@11.21.1`; npm 10 fails on this
dependency tree). Read `docs/BUILD_LOG.md` first: it says what exists and what comes next, and
`docs/CONVENTIONS.md` for the rules the code must follow.

`reference/starter-kit/` is the owner's earlier ERP starter kit, kept read-only for reference. Nothing
under `reference/` is built, linted, tested or shipped, and the product never imports from it.
