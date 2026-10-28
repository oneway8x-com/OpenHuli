# Scripts

## Active scripts

- `architecture-check.mjs` — validates the new `apps/app` and `packages/modules/*` boundaries
- `build-deps-if-stale.mjs` — utility for package build workflows
- `check-prompts.mjs` — validates prompt assets
- `check-staged-line-limit.mjs` — blocks oversized staged source files
- `test-database.ts` — rejects remote/development targets for integration and browser tests
- `setup-test-database.ts` — applies committed migrations to the explicit local test database
- `*.test.ts` — Node tests for test-database safeguards and prompt-check file discovery
- `evaluation-timings.ts` — summarizes exported safe diagnostic phases into counts and p50/p95;
  see [release evaluation](../docs/guides/RELEASE_EVALUATION.md). It never contacts providers or assesses release readiness.

## Retired scripts

Legacy split-runtime bootstrap scripts were removed with the Next.js cutover.
