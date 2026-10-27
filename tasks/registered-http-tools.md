# Registered HTTP tools

## Goal

Implement [#11](https://github.com/oneway8x-com/OpenHuli/issues/11): fixed JSON HTTP operations,
live forecast mapping and a separate persisted notes API with durable idempotency.

## Notes

- Branch `11-registered-http-tools` starts at PR #29 (`f3f7ee1`); #8 is implemented there and #9
  is active in another chat. This PR will stack on #29 without duplicating its executor.
- Issue moved to Project 3 In progress before edits.
- Use the shared registered executor; HTTP policy stays in a feature module, notes persistence in
  a repository. Fixed HTTPS public endpoints; exact loopback demo destinations require opt-in.
- Pin DNS at connection time, reject redirects/compressed or oversized responses, redact provider
  failures. Never replay uncertain POSTs; reconcile notes by the stable execution idempotency key.

## Verification

- Node 24.2.0 (repository requires >=22.19), pnpm 10.26.0; frozen install passed.
- Passed `pnpm typecheck`, `pnpm test` (249 Vitest tests + 3 script tests), `pnpm test:int`
  (56 PostgreSQL integration tests, including 3 real HTTP/executor cases), and `pnpm test:e2e`
  (5 Chromium browser regressions).
- Passed Prisma generation/validation, fresh migration deployment and seeded migration preservation
  on a dedicated disposable loopback test database; no remote database operations.
- Passed `pnpm build`, `pnpm arch:check`, `pnpm prompt:check`, full lint (0 errors; 98 baseline
  warnings), clean affected-file lint, targeted formatting, and diff whitespace checks.
- Real Open-Meteo forecast smoke passed on 2026-10-27 with the documented Berlin example, Celsius,
  Europe/Berlin timezone, dated daily forecast and attribution. This is an adapter smoke, not voice E2E.
- Built and ran the separate notes API. Live registered POST/repeat smoke returned the same committed
  note ID. SQLite restart/isolation and versioned migration preservation also passed.
- Self-review covered fixed URL/method/secret ownership, DNS pinning and mutable-policy races,
  redirect/size/type limits, Tenant/idempotency receipt matching, HTTP 202 and accepted-before-timeout
  reconciliation without another POST. No new npm runtime dependency or application Prisma migration.

## Remaining work / risks

PR publication pending. Stack depends on PR #29 and must land after it. Notes is a loopback demo API,
not a publicly hardened hosted service. Voice/provider wiring remains #10; no hardware/deployment
verification or remote migration was performed.
