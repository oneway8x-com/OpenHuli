# Live conversations

Issue #10 connects device voice and typed turns to one shared conversation use case. The runtime
composes PostgreSQL metadata, the registered executor, and a server-to-server Gemini Live WebSocket.
`device_context` is the first real registered read: it returns the authorized target's configured
name, room, location and capabilities, explicitly labelled configuration rather than live telemetry.
[MQTT telemetry](MQTT_TELEMETRY.md) provides ingestion and a grounded telemetry-tool factory; those tools
are not automatically added to this adapter's default registry. Live forecasts/notes POST belong to #11;
[the owner console](CONVERSATION_CONSOLE.md) supplies typed turns and exact approvals. [Response playback](RESPONSE_PLAYBACK.md) adds bounded output and a reference simulator.

## Provider and configuration

The adapter fixes API `v1beta`, model `gemini-3.8-live`, and the Google TLS endpoint in code.
There is no `latest` alias, runtime-selected destination, automatic fallback, or reconnect/replay.
The stable model name is a provider-maintained version, not an immutable weights snapshot. See
[model contract](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live),
[wire reference](https://ai.google.dev/api/live), and
[WebSocket guide](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket).
Model access and availability must be verified by the opt-in smoke test for the installation.

| Variable                | Default | Meaning                                                       |
| ----------------------- | ------- | ------------------------------------------------------------- |
| `RUNTIME_VOICE_ENABLED` | `false` | Opt-in device endpoint.                                       |
| `GEMINI_API_KEY`        | absent  | Runtime-only Google API credential. No `NEXT_PUBLIC_` prefix. |
| `AI_MAX_TOOL_CALLS`     | `6`     | Per-turn attempted calls, 1–16, including denied calls.       |
| `AI_TURN_TIMEOUT_MS`    | `25000` | Committed model/tool loop deadline, 100–30000 ms.             |

The existing gateway additionally bounds input/queued bytes, output buffering, concurrent sockets,
credential expiry, collecting-turn time, and session lifetime. Gemini handshake is capped at 5 s;
its incoming message size is 128 KiB, pending events 64, and outgoing buffer 256 KiB. Responses are
limited to 1024 output tokens, 4096 text characters, 2,048 processed events/turn, and 1,920,000 bytes of encoded
audio/turn. Exceeding a bound closes the provider instead of silently dropping input/results.

Set the normal database and owner/auth environment from `.env.example` as well: executor policy uses
the same configured owner identity. Production retains existing login email requirements. Apply the
existing migrations and generate Prisma before starting `pnpm dev:runtime` or `pnpm start:runtime`.
Enable voice and inject the key into the runtime process; never send it in pairing configuration,
HTTP responses, firmware, browser code, logs, or committed examples. With no key, enabled voice
remains unconfigured/503. With a key, readiness means configured; each session still verifies its
provider handshake and can fail if Google is unavailable or rejects the model/key.

Gemini expects 16 kHz PCM16LE input; the gateway forwards each 20 ms chunk as it arrives. Automatic
activity detection is disabled. Only an authenticated `turn.commit` ends manual audio activity;
provider calls/content before commit fail closed. Tool declarations explicitly use `BLOCKING`
behavior so the provider must consume results before continuing. Public 24 kHz native audio is
converted to the negotiated 16 kHz format. See [response playback](RESPONSE_PLAYBACK.md) for text
streaming opt-in, truthful tool-turn buffering, generation/playback receipts and cancellation.
Thought parts are discarded; no physical speaker or live latency guarantee is implied.

## Typed turns and session context

Use the same authenticated `/voice` socket, `session.start`, and server `session.ready` as audio.
The paired device still needs its configured microphone and voice credential. An additive atomic
control message supplies a complete typed turn (no binary frames or subsequent commit):

```json
{
  "version": 1,
  "messageId": "m-text-1",
  "type": "turn.text",
  "turnId": "text-1",
  "turnSequence": 1,
  "text": "Which room is this device configured for?"
}
```

Text is 1–4096 nonblank characters, envelope size remains 16 KiB, and IDs/turn sequence must be fresh.
The peer rejects mixed audio/commit on typed turns and concurrent turns. Audio and text may alternate
on one socket; the same live provider connection retains their transient history. A reconnect always
creates a new server conversation. Client-supplied conversation IDs never select another stored run.
Browser cookies/origins are not accepted by this device endpoint; use the [owner console](CONVERSATION_CONSOLE.md) for browser transport.

## Execution, cancellation, retention

The provider receives tool declarations and originating device ID, never authentication secrets.
An internal `verified-device` executor input uses server-owned credential references from the
accepted voice session, checks voice purpose and revalidates the device/credential on every call.
It is not a wire authentication format. Submission/dispatch still enforce active committed turns,
Tenant/source isolation, exact target grants, schema validation, consent, idempotency and deadlines.
The device must have an explicit current `device_context` grant for the exact target device ID;
pairing alone grants no tool. Owner grant APIs are documented in [pairing](DEVICE_PAIRING.md).

Device prompts request clarification of ambiguous writes, fresh/stale evidence, concise answers and
truthful outcomes. Prompts alone are not authorization. Unlisted/invalid/denied calls do not dispatch;
non-success results replace model success language with a fixed unconfirmed response and actual
execution/call IDs and statuses. Provisional language before tool requests is discarded. Unknown,
queued, running, expired, cancelled or approval-waiting outcomes block further automatic calls in
that session, including follow-ups. The [owner console](CONVERSATION_CONSOLE.md) can decide exact
approvals while the originating turn is still active. Approval waiting shares the existing turn
time budget; a completed/stopped turn cannot later dispatch pending work. Do not treat an approval
notice as an executed write.

Cancellation/disconnect aborts provider and executor work, discards partial provider history, and
records a cancelled turn. The socket must reconnect to use a cancelled/failed provider session.
Completed turns retain their provider connection for follow-ups. An already dispatched external
write may have an unknown outcome; the executor conservatively retains that state. Never replay a
voice turn, reconnect with old tool IDs, or retry an uncertain write under a new ID. Operator review
and query-only reconciliation use the existing executor. [Ping/display command tools](DEVICE_COMMANDS.md) are registered only when authenticated MQTT telemetry
is enabled. They require owner consent and exact target grants; no command is registered for a disabled broker.

Raw audio is not persisted. Conversation transcript retention stays off: durable user/assistant rows
contain role/correlation metadata, no text. Tool arguments/results and usage remain operational
records and may include configured room/location; they are not erased by the transcript setting.
Missing usage is left absent/unknown, never synthesized as zero. Known token counts/tool calls are
recorded, without claiming measured provider cost. Google's retention is separate; inspect the
[Gemini terms](https://ai.google.dev/gemini-api/terms) for the account/tier used. Spend policy,
retention cleanup and correlated diagnostics are described in [session operations](SESSION_OPERATIONS.md).
Hosted deployment remains #21.

## Verification and opt-in live smoke

Deterministic tests use `createFakeConversationProvider` and a local WebSocket provider fixture.
Production never selects the fake. Database/socket tests exercise paced PCM before commit, typed
follow-ups, real registered execution, revoked grants, cross-target denial, metadata-only retention,
and usage. Provider wire tests check manual activity, blocking tool declarations, exact result IDs,
precommit/early-completion rejection, bounded queues, secret/error redaction and opening cancellation.

For a live test, provision a synthetic microphone device, give it a `device_context` grant targeting
itself, configure runtime Gemini/owner/database values, and start the runtime. Export the device's
one-time voice credential and ID locally as `OPENHULI_DEVICE_TOKEN` and `OPENHULI_DEVICE_ID`; optionally
set `OPENHULI_RUNTIME_URL` to verified `wss://<host>/voice` (default loopback WS). Do not paste secrets
into shell history, screenshots, issues, or the result record. Then explicitly opt in to a paid call:

```sh
pnpm --filter @corely/runtime smoke:live --live
```

The script requests the real context tool and requires a confirmed tool result before success. It
prints only provider/model/API, typed input, provider readiness/total milliseconds and outcome,
not transcripts, device IDs, URLs or credentials. Session opening logs the versioned `device.assistant`
prompt ID/version/hash, correlation ID and model for reproducibility, without prompt variables. Record those non-secret values, test date,
configuration limits, and a pass/fail note in the task diary. Repeat an audio journey with a real
16 kHz PCM-speaking client or the #12 simulator to verify speech recognition/tool selection;
typed smoke alone does not establish microphone/hardware or audio latency behavior. To stream a local
recording at 20ms intervals, run the same command with `--pcm /path/to/speech.pcm` (raw 16 kHz mono
PCM16LE, no WAV header, complete 640-byte frames, at most 10 s). Record a request to read this device's
configured room; the result must contain a confirmed tool outcome. The input file is not logged or
persisted by the script. No live result
is claimed until such a run is actually performed. Revoke the smoke device's credentials afterwards.
