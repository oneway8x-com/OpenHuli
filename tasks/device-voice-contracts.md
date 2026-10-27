# Versioned device and voice contracts

## Goal

Implement [issue #4](https://github.com/oneway8x-com/OpenHuli/issues/4): bounded, versioned
OpenHuli device, telemetry, command, conversation, tool, approval, error, and binary voice contracts.

## Notes

- Issue moved to Project 3 **In progress** and verified before editing.
- Branch: `04-device-voice-contracts`, based on verified `origin/main` (`88511e4`).
- Work moved to a dedicated managed worktree at the user's request; original checkout is clean.
- Existing copilot/ERP contracts remain unchanged; new exports live in `openhuli/`.
- Persistent runtime, broker, firmware, and live simulator are later tickets. This change provides
  shared parsers and a wire-order validator exercised by server/simulated-device peers.
- Freeze one baseline PCM16LE mono 16 kHz format, 20 ms / 640-byte chunks, a bounded binary header,
  explicit commit/cancel, and separate generation/playback completion. Tenant authority stays external.

## Verification

- Environment: Node 24.2.0 (satisfies `>=22.19.0`), pnpm 10.26.0; frozen-lockfile install and Prisma generation passed.
- Focused protocol tests: 62 passed. Covers documented schema fixtures, authority/version rejection,
  UTF-8/depth/node limits, invalid metrics/capabilities, binary golden bytes, every fragmentation
  split, malformed lengths, duplicate identities, commit/order/cancel, limits, and playback acknowledgement.
- `pnpm typecheck`: passed; contracts now explicitly participate in the root check.
- `pnpm test`: passed, 123 Vitest tests and 3 script tests.
- `pnpm --filter @corely/data exec prisma validate`: passed.
- `pnpm arch:check`: passed.
- `pnpm build`: passed (package ESM/CJS/declarations and Next production build).
- `pnpm lint`: passed, 101 existing warnings in unchanged scaffold files; targeted contracts lint has no warnings.
- `pnpm prompt:check`: passed.
- Formatting checks for new files, changed docs, diary, and package metadata passed. The legacy
  contracts index preserves its existing formatting, adding only the public export.
- Built ESM/CJS public export and binary round-trip smoke passed; changed documentation links resolve.
- Full diff self-review: additive exports only; no dependency, migration, configuration, auth, or UI changes.
- Database integration, browser E2E, live provider/broker, and hardware suites were not run: no
  persistence, UI, or live transport changed; the real runtime and network simulator are later tickets.

## Remaining work / risks

- PR: [#24](https://github.com/oneway8x-com/OpenHuli/pull/24), targeting `main`; pushed for review.
- Runtime consumers must enforce authentication, Tenant ownership, expiry, durable idempotency,
  cancellation reconciliation, and provider pacing/resampling. The peer only validates wire order;
  its simulated exchange is not a live WSS/MQTT or hardware acceptance claim.
- Issue remains In progress pending review; no merge, release, or deployment performed.
