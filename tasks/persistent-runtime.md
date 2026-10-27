# Persistent Node runtime

## Goal

Implement [issue #5](https://github.com/oneway8x-com/OpenHuli/issues/5): one always-on Node host
for persistent sockets, MQTT connections, and future shared conversation use cases.

## Notes

- Project 3 status set to In progress before editing. Branch `05-persistent-runtime` starts from
  `origin/main` (`ba04bf7`), including merged contracts PR #24; reuse the clean isolated worktree.
- Initial base predated owner auth. Follow-up merge includes owner sessions from #3 while keeping
  the runtime probe separate from owner/device authorization.
- This foundation provides health/readiness, a service-token-protected ping/pong socket probe,
  broker lifecycle, abort/cleanup hooks, bounded shutdown, and configuration. Actual authenticated
  device audio (#9), conversation/provider execution (#10), and telemetry (#13) remain separate.
- Add `ws` (already transitively installed) for correct WebSocket framing and `mqtt` for actual
  broker connection/reconnection/TLS lifecycle. Reuse Node HTTP, Zod, tsx, and tsdown.

## Verification

- Environment: Node 24.2.0 (declared minimum 22.19), pnpm 10.26.0. Install updated only the runtime importer and its 24 added packages.
- `pnpm --filter @corely/runtime typecheck` and targeted ESLint: passed, no warnings.
- Runtime tests: 35 passed, with real loopback HTTP/WebSocket listeners and fake broker/provider
  adapters. Covers upgrade authorization rejection, capability-free internal probe, readiness loss/recovery,
  config/secret redaction, idle/concurrency/size bounds, startup timeout/failure, cleanup deadlines,
  nonresponsive peers, rejected half-open upgrades, signal shutdown, and port reuse.
- Runtime tests also passed with generated contracts output temporarily absent: both Vitest and CLI
  child processes resolve shared contract sources, so fresh-checkout tests need no prior build.
- `pnpm typecheck`: passed; runtime is included in the root check. Final runtime changes were also checked directly.
- `pnpm test`: passed, 158 Vitest tests and 3 script tests.
- `pnpm --filter @corely/data exec prisma validate`, `pnpm arch:check`, `pnpm prompt:check`: passed.
- `pnpm build`: passed for packages, runtime, and Next; runtime rebuilt after final shutdown changes.
- Built runtime smoke: startup, real HTTP readiness, SIGTERM, and clean exit passed.
- `pnpm lint`: passed with 101 existing warnings in unchanged scaffold files.
- Formatting, changed documentation links, and diff whitespace checks passed.
- Self-review: no Prisma or Next imports in the host, no Tenant selection or business execution in
  handlers, disabled device routes, bounded abort/cleanup, no secrets in errors, and no schema changes.
- Browser E2E, database integration, live broker/provider, external WSS/TLS, and hardware tests were
  not run: this change adds the host foundation and performs no application data operations or deployment.

## Remaining work / risks

- PR: [#26](https://github.com/oneway8x-com/OpenHuli/pull/26), targeting `main`; pushed for review.
- Broker/provider adapter contracts require prompt abort and idempotent cleanup. Broken adapters
  fail shutdown and force a nonzero CLI exit rather than leaving the process alive.
- Device identity, runtime integration with shared owner sessions, actual audio/conversation/telemetry
  use cases, broker provisioning, and verified external TLS deployment remain in their tickets.
- Issue remains In progress pending review. No PR merge, release, or deployment performed.

## Conflict resolution follow-up

- Merged `origin/main` (`8221a42`, owner-auth PR #25) into the existing PR branch.
- Resolved README, environment guide, and root scripts by retaining both owner bootstrap/identity
  checks and runtime build/start/typecheck integration. Preserved auto-merged auth and lockfile changes.
- Updated runtime trust documentation to acknowledge the shared identity feature and keep device
  credential handling in its existing follow-up scope. No runtime or auth behavior changed.
- Post-merge checks: frozen-lockfile install, typecheck (including identity and runtime), all 188
  Vitest tests plus 3 script tests, Prisma validation, architecture/prompt checks, formatting, links,
  and diff checks passed. Lint passed with 98 existing warnings. Production build passed.
- Verified auth/app/E2E/identity sources match the merged `origin/main`; conflict resolution changes
  only script composition and documentation. No database integration or browser E2E rerun.

- `main` advanced again during validation to `152662c` (persistence PR #27). Merged it and retained
  its all-feature-module typecheck and migration-check command alongside runtime scripts. Existing
  migration/schema/feature files are preserved unchanged; no database migration is applied here.
- Latest-base validation: frozen install and Prisma generation, typecheck across all feature modules
  plus runtime, 188 Vitest tests plus 3 script tests, lint (98 existing warnings), Prisma validation,
  architecture/prompt checks, diff checks, and production build passed. Runtime script entries now
  sit alongside `dev:app` to avoid conflicts with unrelated commands appended to the scripts list.
