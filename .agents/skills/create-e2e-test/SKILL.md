---
name: create-e2e-test
description: Add or extend OpenHuli Playwright coverage for a meaningful browser or system journey. Use for test implementation, not merely running tests or adding unit coverage.
---

# Add an end-to-end test

Follow [AGENTS.md](../../../AGENTS.md). Read [the E2E guide](../../../apps/e2e/README.md),
[the configuration](../../../apps/e2e/playwright.config.ts), and nearby specs and fixtures.

1. Name the user outcome and the observable failure the test should catch. Choose the narrowest
   browser/API journey that proves it; use lower-level tests when they are sufficient.
2. Inspect package scripts, `testMatch`, server startup, global setup, authentication, and base
   URLs. Verify they match the active Next.js app; do not assume legacy scaffold commands work.
3. Reuse existing fixtures and locator patterns. For database-backed tests, verify all effective
   URLs and server processes use a disposable local database. Limit cleanup to test-owned data.
4. Use synthetic data, deterministic boundaries, Playwright locators, and web-first assertions.
   Do not rely on paid AI services, physical hardware, or real third-party credentials for routine
   CI. Keep any requested live/hardware checks separate and accurately labeled.
5. Collect and run the targeted spec with the intended configuration, then check affected shared
   fixtures and the required application checks. Inspect failure artifacts before changing tests.

Report the actual executed tests, outcomes, cleanup, and missing setup. Collection alone is not
a passing run. Do not hide failures with arbitrary waits, extra retries, or unjustified skips.
