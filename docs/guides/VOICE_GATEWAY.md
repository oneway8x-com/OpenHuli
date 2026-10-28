# Authenticated voice gateway

Issue #9 adds `/voice` to the persistent Node runtime and the shared `modules/voice` session use
cases. It streams bounded PCM to a provider port while the user records; it never collects a whole
audio file or treats an incomplete turn as an action request. The [live conversation adapter](LIVE_CONVERSATIONS.md)
adds Gemini, typed turns, persistence and authorized execution. Hardware and hosted TLS validation remain separate.

## Enablement and readiness

`RUNTIME_VOICE_ENABLED=false` keeps the endpoint closed. Enabling it requires `DATABASE_URL` and a
streaming provider composed into `createRuntime` alongside `createVoiceAuthorization`. The current
CLI selects the Gemini adapter only with `GEMINI_API_KEY`. Without it, enabled voice reports
`voice: unconfigured`, readiness and upgrade return 503. Production never selects a fake provider.
Liveness remains available. A successful host/probe check does not prove an available voice service.

The provider boundary is `VoiceProviderFactory` in `packages/modules/voice`. `open` receives only
server-owned Tenant/device/session/conversation context and an abort signal. `startTurn` receives a
turn-bound output channel. `appendAudio` forwards individual 20ms PCM frames during collection and
MUST NOT dispatch tools or start side effects. Only `commit` receives a validated committed context,
after every queued chunk is accepted and the device credential is revalidated. The conversation adapter must
call the shared conversation/execution use cases and retain their approval/idempotency guarantees.
It must never treat upstream model/tool events during collection as permission to execute.

## Client contract

Connect a native device or server-side client to `wss://<runtime-host>/voice` with an
`Authorization: Bearer <voice-token>` header. Use the one-time `voice` credential from
[device pairing](DEVICE_PAIRING.md), not its MQTT token, owner cookies, or runtime probe token.
No credentials in query strings, browser Origins, subprotocols, or claimed Tenant/device headers
are accepted as authority. Plain WS is for loopback tests/local development; public deployments
must terminate verified TLS at the reverse proxy and keep the upstream runtime private.

For example, a Node client using `ws` verifies certificates explicitly:

```ts
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";

const endpoint = new URL(process.env.VOICE_ENDPOINT!);
if (endpoint.protocol !== "wss:")
  throw new Error("A verified WSS endpoint is required");
const socket = new WebSocket(endpoint, {
  headers: { Authorization: `Bearer ${process.env.DEVICE_VOICE_TOKEN}` },
  rejectUnauthorized: true,
  // Omit ca for the system trust store, or load the deployment's trusted private CA.
  ...(process.env.VOICE_CA_FILE
    ? { ca: readFileSync(process.env.VOICE_CA_FILE) }
    : {}),
  handshakeTimeout: 5000,
  perMessageDeflate: false,
});
```

Do not log the headers/token or disable certificate verification. ESP32 certificate/time setup and
live cloud TLS verification are separate firmware/deployment release gates.

Follow the [v1 protocol](../protocol/openhuli-v1.md):

1. Send `session.start` with the supported input format; offer output only for an owner-configured
   speaker. Wait for `session.ready`. Output is negotiated only if the provider supports it.
2. Send `turn.start` with a fresh turn ID, increasing turn sequence, and unused stream ID.
3. Send complete binary frames carrying exactly 640 PCM bytes each. The WebSocket library handles
   fragmentation; total message limits apply across fragments. Ordering/stream/sequence/header
   checks happen before frames enter the bounded queue.
4. Send `turn.commit` with the exact final input sequence, or `turn.cancel`. No audio, invalid final
   sequence, disconnect, cancellation, or duration/queue failure can manufacture a commit.

The incoming `conversationId` is a correlation hint, never an existing-record selector or authority.
The server creates a fresh session/conversation key, returned as `session.ready.sessionId`, and
passes that key to the provider. Reconnect always creates a new key and empty protocol state. There
is no resume/replay in v1, including after an uncertain disconnect. Client turn IDs are scoped to
that server-owned connection. Provider responses are bound to the active committed turn; old output
channels return false after cancellation/completion and cannot inject text/audio into a later turn.

`turn.cancel` immediately aborts the turn even when its provider is slow or a commit is queued behind
unaccepted audio. It closes that turn's provider resources. Disconnect, credential expiry/revocation,
idle expiry, shutdown, and session expiry abort the entire provider session. Cancellation of an
already committed external write does not prove it was undone; #8/#10 retain unknown outcomes
and reconcile rather than retry them. No call is automatically retried by this gateway.

## Limits and cleanup

| Setting                              | Default | Bound                                                                                              |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------------------------- |
| `RUNTIME_MAX_CONNECTIONS`            | 100     | Shared probe/voice/pending-auth/cleanup capacity; one active voice connection per device per host. |
| `RUNTIME_STARTUP_TIMEOUT_MS`         | 5000    | Authentication handshake deadline; unresolved authentication continues to occupy its bounded slot. |
| `RUNTIME_IDLE_TIMEOUT_MS`            | 30000   | Application-message inactivity closes the voice session.                                           |
| `RUNTIME_VOICE_QUEUE_BYTES`          | 21248   | Queued and in-flight input bytes, 664–1048576.                                                     |
| `RUNTIME_VOICE_QUEUE_MESSAGES`       | 64      | Queued and in-flight messages, 1–1024.                                                             |
| `RUNTIME_VOICE_BUFFERED_BYTES`       | 65536   | Maximum queued socket output, 1024–1048576.                                                        |
| `RUNTIME_VOICE_OPERATION_TIMEOUT_MS` | 5000    | Per serialized authorization/provider operation, 100–30000ms.                                      |
| `RUNTIME_VOICE_TURN_TIMEOUT_MS`      | 30000   | Turn wall time, 100–30000ms, independently of the 1500-chunk wire limit.                           |
| `RUNTIME_VOICE_SESSION_TIMEOUT_MS`   | 600000  | Session wall time, 100–3600000ms, capped by credential expiry.                                     |
| `RUNTIME_SHUTDOWN_TIMEOUT_MS`        | 5000    | Provider stop/close and host shutdown deadline.                                                    |

Input overflow closes with 1013; invalid protocol, revocation, or expiry closes with 1008; oversized
WebSocket messages close with 1009; provider/operation failures use 1011. No actionable speech is
silently dropped while a session continues. The queue includes in-flight work. Provider rejection
text and raw device payloads are replaced with bounded generic errors.

Authorization is checked at upgrade, session opening, turn start, and commit. The devices feature's
watchdog also revalidates idle sessions every 15 seconds, with a five-second check deadline; the
credential expiry timer requires no further client message. Scope, revocation, active device/Tenant,
and owner-configured microphone are resolved from stored records, not the request.

Provider ports must honor abort and implement idempotent `stop`/`close`. Late handles are closed;
in-flight promises are tracked during cleanup. A provider ignoring abort cannot keep the connection
slot reusable indefinitely: failed cleanup removes readiness and the CLI's bounded shutdown exits
nonzero for orphan-prone adapters. Output congestion terminates the socket. Keep this single-host
capacity policy when deploying; distributed limits and spend budgets are #20/#21.

## Verification

Deterministic tests use paced fake providers and real loopback sockets. They cover early forwarding,
commit/cancel ordering, fragmentation, partial disconnects, reconnect, stream/sequence/size errors,
slow queues/deadlines, stale output, authorization capacity, expiry, secret redaction, and shutdown.
PostgreSQL socket tests use real paired credentials to reject MQTT/tampered/revoked/expired secrets.
No paid provider or live device is needed. Follow the root test database guard and never use a remote DB.

## Response playback

See [streaming responses and playback](RESPONSE_PLAYBACK.md) for optional incremental public text,
execution status events, converted audio, client sink receipts and cancellation. Existing sessions
remain final-text-only unless streaming is offered; output audio is negotiated separately.
