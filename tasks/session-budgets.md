# Session budgets, privacy and diagnostics

## Goal

Implement [#20](https://github.com/oneway8x-com/OpenHuli/issues/20) on `20-session-budgets`, based on merged `origin/main`.

## Notes

- Project status moved to In progress before edits. No open PR claims this issue; required software dependencies are merged. Hardware work needs verified parts and physical acceptance.
- Conversation feature owns durable UTC quotas, conservative spend reservations, privacy use cases and allowlisted trace metadata. Shared voice/text runtime enforces them.
- Reservations are admission allocations, not reported provider billing. Never refund uncertain usage. Provider-side retention and billing are separate from application policy.
- Preserve execution identity tombstones to prevent a privacy request or cleanup from enabling repeated external writes.

## Verification

- `pnpm typecheck`: passed; affected runtime and device-command type checks also passed after final changes.
- `pnpm test`: 373 tests passed, plus script tests.
- `pnpm test:int`: 107 PostgreSQL integration tests passed against an explicitly disposable local database.
- Migration deployment passed; `pnpm test:migrations` passed fresh and seeded compatibility cases, including the new transactional migration.
- `pnpm --filter @corely/data exec prisma validate`, `pnpm arch:check`, `pnpm prompt:check`: passed.
- `pnpm lint`: passed with 98 existing warnings; final affected files have no lint errors or warnings. Changed TypeScript/Markdown formatting and diff whitespace checks passed.
- `pnpm build`: passed, including the final repeat after the late-receipt privacy guard.
- Added behavioral coverage for admission races, daily/session audio across reconnects, unknown final usage, spend abort before dispatch, trace redaction, owner-only endpoints, expiry cleanup, tenant isolation, retained unknown write identities, and late reconciliation/receipt privacy protection.
- Initial shared-artifact rebuild/test overlap caused module resolution failures; sequential reruns passed. One existing 150ms command receipt test failed under concurrent check load; subsequent full integration runs passed without changing it.

## Remaining work / risks

- Full diff self-reviewed, including cancellation, tenant scoping, expiry and no-replay behavior. PR publication pending. The owned disposable database cluster was stopped and removed after verification.
- No provider key is configured, so the required measured live provider trace is unverified. Draft PR until that acceptance check is recorded. No hardware, live billing or deployed TLS acceptance is claimed.
- Spend reservations cap admission allocations and observed estimates; delayed/missing provider usage cannot guarantee an invoice cap. Provider-side controls and retention remain separate.
- Payloads/trace events expire; minimal execution tombstones remain to prevent replay. Active dispatch/reconciliation must be resolved before cleanup. Unknown executions whose arguments were deleted cannot be automatically reconciled using those arguments.
