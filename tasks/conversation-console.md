# Conversation console

## Goal

Implement [#18](https://github.com/oneway8x-com/OpenHuli/issues/18) on `18-conversation-console` from merged main `43ef4f5`.

## Notes

- UI owns `/conversations`; runtime owns provider sessions and registered tools. Browser requests use same-origin authenticated Next routes; owner cookies/tokens never enter browser JavaScript or provider context.
- Reuse shared conversation use cases/runtime and exact-argument approval executor. Persisted activity is read through tenant-scoped repository methods. Refresh restores metadata; default-off transcript retention does not restore text.
- #11 merged as PR #36 while this task was being validated. Merged main `93be224` and composed its registered HTTP tools for both owner/voice. Tests use deterministic forecast bytes plus the real loopback notes HTTP service/SQLite. No paid AI or live forecast call.

## Verification

- Frozen/offline install passed with only the runtime's new workspace link; no external dependency versions changed.
- `pnpm typecheck` and `pnpm build` passed after merging #11, including runtime, notes API, Next app and E2E source types.
- `pnpm test`: 343 Vitest tests plus 3 script tests passed. Includes partial-outcome truthfulness and keyless runtime startup/auth/shutdown.
- `pnpm test:int`: 91 PostgreSQL integration tests passed, including exact approval/hash/target binding, duplicate turns, denial/cancel, expiry, timeout, unknown/partial outcomes, redaction and read-only restoration after runtime replacement.
- `pnpm test:e2e`: all 10 browser tests passed against real auth/routes/runtime/executor/DB. A final focused HTTP journey passed again with visible source/license links. The notes journey performed a real local POST into a separate SQLite database; upstream forecast bytes and AI are fixtures.
- Prisma validation, architecture/prompt guards, formatting and diff checks passed. Lint: zero errors, 98 existing warnings; changed implementation files are clean.
- Inspected desktop, 390px mobile and exact-approval screenshots. Evidence stays outside Git at `/tmp/openhuli18-console-{desktop,mobile,approval,http}.png`.
- A local disk-space error interrupted Docker-based verification. Removed this worktree's generated Next cache, then ran all final database/browser checks on an isolated native PostgreSQL test instance; no remote database was touched.

## Remaining work / risks

- The native disposable PostgreSQL instance was stopped and its data removed. Docker remained unresponsive, so cleanup of the earlier `openhuli-console-test` container could not be confirmed.
- No paid Gemini, live Open-Meteo, deployment or hardware test was run. No key was requested; the user previously chose documented live smoke instructions.
- Console output is text-only. Default transcript retention remains off; refresh restores operational metadata, not previous text.
- Approvals must finish within the originating turn's existing time budget (25 seconds by default). Sessions expire after at most five minutes; process restart makes prior activity read only. These bounds and safe reconnect behavior are documented in `docs/guides/CONVERSATION_CONSOLE.md`.
- PR: [#37](https://github.com/oneway8x-com/OpenHuli/pull/37), `18-conversation-console` → `main`.
