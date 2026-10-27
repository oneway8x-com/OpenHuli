# Device and conversation persistence

## Goal

Implement [#6](https://github.com/oneway8x-com/OpenHuli/issues/6): tenant-safe durable device and conversation storage.

## Notes

- Branch: `codex/device-conversation-persistence`, rebased onto `origin/main` including #4 contracts and #25 owner authentication.
- The user requested a PR after implementation, authorizing the scoped commit and push.
- Reuse AgentRun for conversations, Message for optional transcripts, ToolExecution for durable tool-call identity. Add feature-owned device and conversation repositories and explicit use cases.
- Composite foreign keys enforce tenant and conversation ownership. Raw audio has no persistence field; transcript retention defaults off.

## Verification

- Used Node 24.2.0 (satisfies `>=22.19.0`) and pnpm 10.26.0.
- `pnpm install --offline --frozen-lockfile --ignore-scripts`: passed; only added local module importers, no dependency version changes.
- `pnpm prisma:generate` and `pnpm --filter @corely/data exec prisma validate`: passed.
- `pnpm test:db:setup`: both committed migrations deployed successfully to a fresh disposable local PostgreSQL 17 database.
- `pnpm test:migrations`: fresh and seeded baseline schemas passed; preserved existing run metadata, transcripts, unknown execution outcomes, integration connections, audit logs, and idempotency keys.
- `pnpm test:int`: 28 PostgreSQL-backed tests passed after rebasing (14 new, 14 existing), including tenant boundaries, concurrent duplicates/approval decisions, credential/grant revocation and expiry, command expiry/results, optional transcripts, cancelled turns, and separate generation/playback completion.
- `pnpm typecheck`: passed; affected module typechecks also passed after final changes.
- `pnpm test`: 153 Vitest tests and 3 script tests passed after rebasing.
- `pnpm lint`: passed with 98 existing warnings; focused lint on all new TypeScript and integration configuration passed without warnings.
- `pnpm arch:check`, `pnpm prompt:check`, and `pnpm build`: passed.
- Targeted Prettier checks and `git diff --check`: passed. Self-reviewed schema, migration, repositories, use cases, consumers/configuration, and tests.
- No remote database mutations. The existing local E2E artifact was preserved. No browser tests were needed for this storage-only change.

## Remaining work / risks

- No remaining implementation work for this issue. [PR #27](https://github.com/oneway8x-com/OpenHuli/pull/27) opened against `main`. Implementation committed and pushed; no deployment requested.
- Pairing endpoints, registered-tool authorization, runtime dispatch, transport delivery, and cleanup scheduling remain separate MVP issues; these storage use cases require authenticated server context.
- The migration intentionally rejects legacy rows whose tenant differs from their parent run; repair such inconsistencies explicitly before upgrading an existing installation.
- Tool arguments/approval snapshots remain necessary operational data even when transcript retention is disabled; this policy is documented in the architecture note.
