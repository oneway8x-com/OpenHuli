# Shared live conversation runtime

## Goal

Implement #10 on `10-conversation-runtime` from merged #9 (`cfb75f5`). Project 3 status verified In progress before editing.

## Decisions

- Conversations own the bounded voice/text loop; runtime composes Gemini Live, persistence and the registered executor.
- Provider model is pinned to `gemini-3.8-live`, API v1beta; automatic activity detection is disabled so only an explicit commit may dispatch.
- Keep provider keys server-only, audio/transcripts unpersisted by default, and session history in the live provider connection.
- Text turns use an additive bounded voice control message. Console owner UI remains #18; speaker output remains #17.
- A cancelled/failed provider session is discarded, never resumed/replayed. Tool cancellation preserves unknown write outcomes.

## Verification

- Frozen offline installation passed. Only workspace dependency links changed; no external versions or migrations added.
- Full typecheck and production build passed (packages, persistent runtime, Next, E2E source types).
  Focused feature/runtime typechecks also passed after final cleanup and smoke CLI changes.
- 267 Vitest tests plus 3 script tests passed; includes 16 shared-loop cases, 8 provider-wire cases,
  typed peer ordering/bounds and configuration checks. Deadlines also stop a provider that ignores cleanup.
- All 57 PostgreSQL integration tests passed against a disposable local database after committed migrations.
  Two new socket journeys cover voice/text actual execution, follow-up history, cross-target/grant denial,
  configured versus live evidence, usage and metadata-only transcript retention.
- Prisma validation, architecture/prompt guards and full lint passed (0 errors, 98 existing warnings).
  Prompts live in the existing versioned prompt package; no inline prompt guard exceptions added.
- Built-process smoke: voice disabled -> readiness 200; enabled without key -> 503; enabled with a
  synthetic key -> configured readiness 200. All three shut down cleanly with SIGTERM. No provider
  connection/request was made by this configuration/lifecycle smoke.
- Self-reviewed commit gating, credential-reference revalidation, target grants, result/turn ordering,
  unknown-outcome action blocking, cancellation, queue budgets, provider error redaction and shutdown.
- Initial test setup omitted the profile's required ping capability; corrected fixture and reran.
  Extending internal authentication required narrowing existing token-only test fixture types.
  Offline unconstrained resolution lacked metadata; preserved existing lock versions and verified frozen install.

## Remaining work / risks

- Committed and pushed `10-conversation-runtime`; draft PR [#32](https://github.com/oneway8x-com/OpenHuli/pull/32) targets `main`. Live Gemini access, real speech selection, measured provider latency and
  provider retention behavior have not been verified. No live credential location was supplied; the
  opt-in typed/PCM smoke procedure and command are ready for that validation. Keep #10 In progress.
- Default registered tool is an authorized configuration read. HTTP writes/forecasts are #11; console
  owner UI is #18; incremental audio/playback is #17; broader spend/retention/deployment are #20/#21.
- Model responses remain untrusted. Non-success tool outcomes suppress model success language; prompt
  instructions request clarification and grounded outcomes but cannot guarantee arbitrary model quality.
- Provider-native 24 kHz audio is bounded/consumed, not sent as 16 kHz protocol playback. No hardware,
  broker, hosted TLS, remote migration, deployment or PR merge was performed.
- Failed/cancelled provider history is discarded and requires reconnect. Follow-ups after successful
  turns reuse the connection. Missing token usage remains absent/unknown. No raw audio/transcript is stored;
  tool argument/result metadata can include configured location and remains operational data.
