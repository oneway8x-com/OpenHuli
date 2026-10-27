# Authorized tool execution

## Goal

Implement [#8](https://github.com/oneway8x-com/OpenHuli/issues/8): registry-backed authorized tool execution, exact approvals, durable deduplication, and explicit reconciliation.

## Notes

- Branch `codex/authorized-tool-execution`, based on main with #3/#4/#6/#7 merged. #5 was already covered by PR #26 and is now merged; rebased onto that runtime foundation.
- Reuse ToolExecution and ExecutionApproval. Keep provider registration server-owned, transport handlers thin, and Prisma in repositories.
- Authenticate through existing owner/device use cases; preserve the originating session and recheck grants/tenant/turn state at dispatch.
- Write timeouts remain unknown and cannot be retried through execution. Reconciliation queries provider outcomes using the same durable identity.

## Verification

- Prisma generation/validation passed. Fresh deployment of all four migrations and seeded-baseline preservation passed on disposable local PostgreSQL 17.
- `pnpm test:int`: 53 tests passed, including 16 new executor tests with deterministic fake effects and actual PostgreSQL constraints/races.
- `pnpm test`: 209 Vitest tests and 3 script tests passed, including 3 new registry tests.
- `pnpm typecheck`, `pnpm build`, `pnpm arch:check`, `pnpm prompt:check`: passed; affected module typechecks passed after final changes.
- `pnpm lint`: passed with 98 existing warnings; focused lint on changed TypeScript passed without warnings.
- Migration/schema drift check reported no difference; formatting and `git diff --check` passed.
- Self-reviewed complete request/approval/dispatch/reconciliation flows and tenant scoping. No live providers, remote migration, deployment, or UI/E2E changes.

## Remaining work / risks

- Combined checks with the merged runtime foundation passed; final PR handoff in progress.
- Real provider/tool registrations and transport/console integration remain their separate MVP tickets. An unknown write without query-only provider reconciliation requires explicit operator investigation.
- Registered callbacks must truthfully declare effect, honor AbortSignal, use the stable provider key, and bump revision for schema/executor/destination changes. No universal exactly-once guarantee is claimed.
