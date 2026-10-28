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

- Initial implementation merged in [PR #40](https://github.com/oneway8x-com/OpenHuli/pull/40). Its owned disposable database cluster was stopped and removed after verification.
- No provider key is configured, so the required measured live provider trace is unverified. That acceptance check remains unrecorded. No hardware, live billing or deployed TLS acceptance is claimed.
- Spend reservations cap admission allocations and observed estimates; delayed/missing provider usage cannot guarantee an invoice cap. Provider-side controls and retention remain separate.
- Payloads/trace events expire; minimal execution tombstones remain to prevent replay. Active dispatch/reconciliation must be resolved before cleanup. Unknown executions whose arguments were deleted cannot be automatically reconciled using those arguments.

## Privacy race follow-up

- PR #40 merged while another implementation was being reconciled. The independent alternative is
  preserved locally on `20-session-limits`; it is not published or included in this follow-up.
- CI exposed a delayed backend `DeviceCommandRepository.finish` restoring `resultJson` after privacy
  cleanup. A gated publisher regression reproduced the failure deterministically: the executor had
  already returned unknown, privacy erased the payload, then the publisher resumed and restored data.
- Follow-up branch `20-privacy-cleanup-race` starts at the merged main. Backend settlement now checks
  the payload marker atomically and updates only status/time on an erased command. Device receipts
  and write identities retain their existing protection; no effect is repeated.
- Follow-up verification: full typecheck, 373 unit tests plus script tests, 108 PostgreSQL integration
  tests, all 14 Chromium journeys, production build, Prisma validation, architecture/prompt guards,
  lint (98 existing warnings), changed-file formatting and whitespace checks passed. The focused
  18-case device-command suite and five-case conversation browser suite also passed.
- Self-review covered atomic privacy fencing, conservative status settlement, Tenant scope,
  sequential provider-slot release and nonrefundable daily allocations. Follow-up PR pending.

- The complete browser suite also exposed sequential conversations leaking idle provider slots under
  the new concurrency policy. New conversation now stops the selected live session before opening its
  replacement; activity remains readable and budget allocations are not refunded. The existing browser
  journey checks both prior sessions are read-only without weakening concurrency limits.
- Stabilized the late-arrival regression by fixing its simulated completion time inside the command
  window. The 150ms test deadline and receipt validation are unchanged.
