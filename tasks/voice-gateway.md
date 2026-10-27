# Authenticated voice gateway

## Goal

Implement [#9](https://github.com/oneway8x-com/OpenHuli/issues/9) on `09-voice-gateway` from merged runtime/credentials/contracts (`a0e2493`). Ticket moved to In progress in Project 3 before editing.

## Notes

- Reuse this chat's clean runtime worktree. #8 is being implemented elsewhere; preserve other checkouts.
- Shared voice session use cases own protocol/turn lifecycle and bounded provider forwarding;
  runtime owns sockets, device authentication composition, and connection shutdown.
- Stream each accepted PCM chunk while collecting. Only an explicit validated commit, after queued
  chunks are accepted and authorization is rechecked, permits provider dispatch. Cancel/disconnect
  abort collection and never commit. A fresh server session/conversation is created on reconnect.
- Keep the provider boundary explicit. Live provider composition is #10; do not add a fake production
  adapter or claim live speech support. Socket tests inject paced fake streaming providers.

## Verification

- Frozen offline installation passed; no external dependency versions changed.
- Full typecheck passed, including all feature modules, runtime, Next app, and E2E sources.
- 233 Vitest tests plus 3 script tests passed. New coverage includes 17 voice socket cases,
  seven configuration cases, and three shared session cleanup/output tests.
- 39 PostgreSQL integration tests passed, including two socket journeys with actual paired
  voice/MQTT credentials, tampering, revocation before commit, and idle credential expiry.
- Prisma validation, architecture/prompt checks, formatting/diff checks, and full lint passed.
  Lint retains 98 pre-existing warnings; focused new-code lint is clean.
- Production build passed for shared packages, runtime, and Next. Built-runtime smoke passed:
  voice disabled gives readiness 200; enabled without a provider gives 503; both exit cleanly
  on SIGTERM. No paid provider, external broker, hosted TLS, or hardware calls were made.
- Self-reviewed authorization, commit ordering, cancellation during queued work, bounded pending
  authentication/input/output, stale output rejection, late handle cleanup, and shutdown.
- One test fixture initially omitted its dependency argument; corrected it and reran the full suite.
  Application/device sources outside the scoped voice helper are unchanged. No migration required.

## Remaining work / risks

- Implementation and required checks complete; PR handoff below.
- The CLI has no live streaming provider until #10. Voice is disabled by default and explicitly
  unready when enabled without a provider; no fake successful speech/action path is shipped.
- Gateway queues are per single runtime host. #20/#21 own distributed/spend limits and verified
  public TLS deployment. Client certificate verification is documented; tests use local sockets.
- Raw audio/transcripts are not persisted by this gateway. #10 must compose durable conversation
  and executor use cases and preserve unknown outcomes after cancellation of committed writes.
- No browser E2E rerun was needed for this transport-only feature; existing browser source types
  and the Next production build pass. No remote database changes or deployment.
