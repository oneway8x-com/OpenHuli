# Registered HTTP tools

## Goal

Deliver [#11](https://github.com/oneway8x-com/OpenHuli/issues/11) to main: fixed JSON HTTP operations,
live forecast mapping and a separate persisted notes API with durable idempotency.

## Notes

- Original implementation was published in [PR #30](https://github.com/oneway8x-com/OpenHuli/pull/30),
  merged into `codex/authorized-tool-execution` after #29 had already merged. Its changes were absent
  from main. The 2026-10-28 handoff uses `11-http-tools-main` from current main (`43ef4f5`).
- Issue #11 verified In progress. #12 returned to Backlog because the real HTTP tools must land first.
  The existing clean #11 worktree is preserved; this branch reuses its implementation commit.
- Resolved shared configuration, scripts, lockfile and integration-suite conflicts by preserving
  current voice, playback, device-command and telemetry behavior alongside the notes API checks.
- Use the shared executor. Fixed HTTPS destinations are server-owned; DNS is pinned, redirects and
  oversized/compressed responses rejected, and provider failures redacted. Private access requires
  an exact loopback demo destination. Credentials never come from model arguments.
- Notes has its own SQLite repository and versioned migrations, independent of application tables.
  Never retry uncertain POSTs: reconcile only by querying the original stable Tenant/execution key.
- Provider/conversation wiring is separate simulator work in #12. This handoff adds no live voice gate.

## Verification

- Frozen offline install, focused HTTP/notes tests (40), and full typecheck passed on the main-based branch.
- `pnpm test`: 341 tests plus script checks passed. `pnpm test:int`: 86 tests passed on an isolated
  disposable local PostgreSQL 17 cluster, including actual HTTP execution/reconciliation cases.
- `pnpm build`: packages, runtime, notes API and Next app passed. Prisma validation, architecture/prompt
  guards and fresh/seeded migration checks passed. No application schema changes are introduced.
- Lint passed with 98 existing scaffold warnings and no changed-file warnings.
- Current live Open-Meteo forecast smoke passed with the documented synthetic location, attributed
  Celsius forecast and dated result. Built notes API POST/repeat smoke passed against a temporary
  SQLite database. Neither smoke establishes live voice/provider coverage.
- `pnpm test:e2e`: five Chromium browser regressions passed. Changed-file formatting, local document
  links and complete diff whitespace checks passed. Self-review covered Tenant identity, exact
  destination ownership, secret redaction, uncertain writes and compatibility with current main.

## Remaining work / risks

- Published [PR #36](https://github.com/oneway8x-com/OpenHuli/pull/36), targeting `main` from
  `11-http-tools-main`. Current branch checks passed; GitHub CI pending at handoff. No merge or
  deployment authorized. The owned disposable PostgreSQL cluster was stopped and removed.
- The notes API is a loopback demo, not a publicly hardened hosted service.
- Physical hardware and live voice-to-provider-to-API behavior remain outside this adapter handoff.
