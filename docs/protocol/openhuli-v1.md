# OpenHuli device and voice protocol v1

Status: frozen baseline for [issue #4](https://github.com/oneway8x-com/OpenHuli/issues/4).
The schemas, codecs, and connection-local ordering validator are exported by `@corely/contracts`.
[Machine-readable examples](v1.examples.json) are validated in the contract tests, including a
complete server/simulated-device exchange. This is a contract implementation: the persistent host
(#5), durable execution (#8), network simulator (#12), and firmware (#16) are separate work.

## Compatibility and authority

All new top-level device, voice, conversation, tool, execution, and approval messages have integer
`version: 1`. Unknown versions, types, capability kinds, and object fields are rejected. Existing
copilot, approval-policy, and other scaffold exports remain unchanged. Their permissive schemas are
not the OpenHuli wire protocol; consumers must explicitly select the new schemas. No database
migration or environment variable is introduced. A future incompatible layout or format requires
a new version and explicit negotiation; never reinterpret v1 bytes.

No inbound message carries `tenantId`, owner identity, credentials, URLs, or permissions. Device IDs,
conversation IDs, tool names, capability claims, approvals, and model arguments are untrusted
references. Resolve Tenant, membership, grants, and device identity from the authenticated server
context. Bind a validated manifest to that device and check conversation ownership **before**
creating a peer. A claimed manifest does not establish permission to publish, execute, or call AI.
Schemas and the wire-order validator do not replace feature use cases, authorization, persistence,
registered-tool argument validation, clock/expiry checks, or deduplication across restarts.

## Common limits and JSON parsing

Use `parseOpenHuliJson(text, schema)` on complete UTF-8 JSON messages. It rejects payloads above
16,384 bytes, depth above 8 (root depth 0), or more than 1,024 JSON nodes before recursive validation.
Configure the transport with the same byte limit before allocating/assembling incoming messages.
JSON examples have no BOM. Arrays/objects are bounded further by individual schemas. Tool argument,
output, and schema objects allow JSON only: finite numbers, strings up to 4,096 UTF-16 code units,
arrays up to 64 elements, and object keys of 1–64 code units. No functions or provider objects.

| Field                      | Representation                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| IDs                        | 1–64 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._-]*`                                  |
| `messageId`                | Unique per delivery within the connection, across both senders; use sender-specific prefixes |
| `sequence`, `lastSequence` | Unsigned 32-bit integer, starts at 0; no wraparound                                          |
| `streamId`, `turnSequence` | Unsigned 32-bit integer greater than 0                                                       |
| Timestamps                 | ISO 8601 with UTC `Z` or explicit offset; compare instants, not strings                      |
| Text length                | UTF-16 code units, matching JavaScript/Zod; UTF-8 byte limit also applies                    |

Specialized helpers: `parseDeviceManifest`, `parseDeviceTelemetry(text, boundManifest)`,
`parseDeviceCommand(text, boundManifest)`, `parseOpenHuliVoiceClientMessage`, and
`parseOpenHuliVoiceServerMessage`. Telemetry/command helpers additionally check the device ID and
required capability against the bound manifest. Exported schemas accept already-decoded values;
use the bounded JSON helper at a wire boundary. Parse errors throw; transports map them to bounded,
redacted `OpenHuliErrorSchema` responses and must not echo raw payloads, tokens, or provider errors.

## MQTT device messages

Reserve these topics, with broker ACLs binding the authenticated device to its exact ID. Topic and
payload identity must agree; neither chooses Tenant. MQTT QoS 1 may deliver duplicates.

| Direction       | Topic                                      | Type / schema                                         |
| --------------- | ------------------------------------------ | ----------------------------------------------------- |
| Device → server | `openhuli/v1/devices/{deviceId}/manifest`  | `device.manifest` / `DeviceCapabilityManifestSchema`  |
| Device → server | `openhuli/v1/devices/{deviceId}/telemetry` | `device.telemetry` / `DeviceTelemetrySchema`          |
| Server → device | `openhuli/v1/devices/{deviceId}/commands`  | `device.command` / `DeviceCommandSchema`              |
| Device → server | `openhuli/v1/devices/{deviceId}/results`   | `device.command.result` / `DeviceCommandResultSchema` |

The manifest includes `firmwareVersion` (1–64 characters) and 1–6 unique capabilities:
`temperature`, `humidity`, `microphone`, `speaker`, `display`, `ping`. Microphone/speaker declare the
exact PCM format below. Display declares `maxTextLength` (1–512). Unknown capability kinds require
a protocol revision, rather than silently enabling hardware. Persist only capabilities verified
and allowed by the server's device policy.

Telemetry includes `deviceId`, `bootId` (fresh on each boot), `sequence`, `sampledAt`, and 1–2
unique readings. Temperature is finite −40 through 125 `degC`; humidity is finite 0 through 100
`percent`. Missing/failed readings are omitted, never NaN, null, or fabricated zeroes. At least one
reading must remain. Receiver freshness and clock plausibility are policy, not device authority.
Use `(authenticated device, bootId, sequence)` for telemetry deduplication in persistence; do not
assume global sequence order across reboots or MQTT retransmissions.

Commands contain `deviceId`, stable `commandId`, `executionId`, `issuedAt`, `expiresAt`, and `action`:
`{"kind":"ping"}` or `{"kind":"display.write","text":"..."}`. Expiry must follow issuance.
The helper rejects unsupported commands and text above the bound display limit. Firmware must
check expiry against a trusted/synchronized clock, reject unsupported actions, and suppress
re-execution of the same command ID. A retransmission keeps its command/execution IDs and exact
action; `messageId` is a delivery identity. Commands must not be retained by MQTT. Broker publish
acceptance is not success. Persist result deduplication and command recovery in the command feature;
this contract does not provide durable firmware replay storage.

Results echo `deviceId`, `commandId`, and `executionId`, with `completedAt` and status `succeeded`,
`failed`, `expired`, `cancelled`, or `unknown`. All non-success results require a structured error;
success has no error field. Validate result correlation against the stored tenant-scoped command.
A timeout after a possible side effect is `unknown`, not success/failure or permission to retry.

## Conversations, tools, and approvals

- `OpenHuliConversationSchema`: `conversationId`, `createdAt`.
- `OpenHuliTurnSchema`: conversation/turn IDs, positive `turnSequence`, source `text`/`voice`, and
  status `collecting`, `committed`, `responding`, `completed`, `cancelled`, or `failed`.
- `OpenHuliTextTurnInputSchema`: conversation/turn IDs and 1–4,096-character text. Text goes through
  the same tenant-scoped conversation and execution use cases as committed voice input.
- `OpenHuliToolDefinitionSchema`: registered `toolId`, description (1–512), effect `read`/`write`,
  approval policy `never`/`required`, JSON `inputSchema` and `outputSchema`. These are data envelopes,
  not a JSON Schema interpreter. The registry owns supported schema keywords and actual validators.
  Devices and models cannot register definitions, select destinations, or change approval policy.
- `OpenHuliToolCallSchema`: `toolCallId`, conversation/turn IDs, registered `toolId`, JSON `arguments`.
  Parse syntax, then validate arguments against that tool's registered validator and grants.
- `OpenHuliApprovalRequestSchema`: `approvalId`, `executionId`, complete exact `toolCall` snapshot,
  and `expiresAt`. Decisions carry those two IDs and `approve`/`reject`; they cannot replace arguments.
  The authenticated owner's use case must load the stored snapshot, check Tenant, expiry and current
  grant, and ensure it has not changed before executing. Device approval messages are not supported.

`OpenHuliExecutionSchema` always carries execution/tool-call IDs, `updatedAt`, and a status:

| Status              | Required detail | Meaning                                                                   |
| ------------------- | --------------- | ------------------------------------------------------------------------- |
| `queued`            | None            | Accepted for later processing                                             |
| `awaiting_approval` | `approvalId`    | No side effect authorized yet                                             |
| `running`           | None            | Execution started, result pending                                         |
| `succeeded`         | JSON `output`   | Confirmed completed result                                                |
| `failed`            | `error`         | Confirmed failure                                                         |
| `expired`           | `error`         | Deadline passed before allowed execution                                  |
| `cancelled`         | `error`         | Confirmed cancellation; does not assert an irreversible effect was undone |
| `unknown`           | `error`         | Effect may have occurred; reconcile without blindly repeating a write     |

Execution transition policy and durable idempotency belong to the execution feature, not this wire
validator. Cancellation after an uncertain write must preserve `unknown`. Error objects contain
`code`, bounded `message` (1–256), `correlationId`, and `retryable`. Codes are enumerated by
`OpenHuliErrorSchema`. `retryable` describes policy, not automatic authorization for another write.

## WSS negotiation and controls

One authenticated connection handles half-duplex push-to-talk. Create `OpenHuliVoicePeer("server",
boundManifest)` on the server and `OpenHuliVoicePeer("device", boundManifest)` in a simulator.
Validate both sends and receives with `sendControl`/`receiveControl` and
`sendAudio`/`receiveAudio`. Send controls as text WebSocket messages, audio as binary messages.
The peer validates direction, negotiation, IDs, sequence, capabilities, and turn order; it does
not open a socket, buffer audio for AI, or dispatch a use case. Feed only accepted committed turns
to the authenticated conversation use case. Reconnect uses a fresh peer; no audio resume in v1.

| Sender | Type                         | Additional fields / rule                                                                                              |
| ------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Device | `session.start`              | `conversationId`, `inputFormat`, optional `outputFormat`; microphone required, offered output requires speaker        |
| Server | `session.ready`              | Server-issued `sessionId`, `inputFormat`, optional `outputFormat`; output must have been offered                      |
| Device | `turn.start`                 | `turnId`, `turnSequence`, `streamId`; first turn 1, increment exactly once per start including cancelled/failed turns |
| Device | `turn.commit`                | `turnId`, `lastSequence`; at least one contiguous input chunk, final input index must match                           |
| Device | `turn.cancel`                | `turnId`; allowed during collection, response generation, or playback                                                 |
| Server | `response.text`              | `turnId`, `text` (1–4,096); one final text response per committed turn                                                |
| Server | `audio.start`                | `turnId`, fresh `streamId`, negotiated `format`; committed turn and selected output required                          |
| Server | `audio.generation.completed` | `turnId`, `streamId`, `lastSequence`; at least one output chunk, final output index must match                        |
| Device | `playback.completed`         | Same IDs and final index; only after generation is complete and the hardware queue has drained                        |
| Server | `turn.completed`             | `turnId`; committed, response exists, and any audio has generation and playback confirmation                          |
| Server | `turn.failed`                | `turnId`, `error`; terminates current turn even before commit                                                         |
| Server | `session.error`              | `error`; terminal connection error; close the connection                                                              |

Each JSON control includes `version` and unique `messageId`. All turn events carry `turnId`.
At most one active turn; IDs and streams cannot be reused within a session. The input and output
streams are distinct. Limit each stream to 1,500 chunks (30 seconds), each session to 256 started
turns and 8,192 control messages; reconnect with fresh authentication when exhausted. Transports
also need wall-clock idle/session limits, pacing, and provider budgets (later runtime tickets).

Input audio is allowed only between start and commit. Output is allowed only after commit and
`audio.start`, ending at `audio.generation.completed`. Generation completion means no more audio
will be sent; it does **not** mean the speaker finished. Firmware sends `playback.completed` only
after its final sample is physically played. Microphone-only clients receive text and never send
playback acknowledgements. An output negotiation may be declined by omitting it from ready.

Cancel immediately discards buffered input and stops local playback; the runtime cancels provider
work and requests cancellation of pending execution. `close()` on disconnect similarly discards
uncommitted input; a fresh connection must never auto-commit it. Already committed external effects
still require durable reconciliation. Old/duplicate/out-of-order events and late audio after cancel
are rejected, including packets for a prior turn. During a cancellation race, adapters may discard
these stale packets without redispatching them; unexpected active-turn violations terminate the
session. Cross-direction cancellation is not a total network ordering guarantee.

## Baseline audio and frozen binary header

The only accepted v1 format, for both input and negotiated output, is:

```json
{
  "encoding": "pcm_s16le",
  "sampleRateHz": 16000,
  "channels": 1,
  "chunkDurationMs": 20
}
```

Each chunk is exactly 320 signed 16-bit samples / 640 bytes. PCM sample data is little-endian;
there is no WAV header. Pad the final partial chunk with silence. The provider adapter is responsible
for resampling 16 kHz input to its provider's native rate and resampling provider output to 16 kHz,
including channel conversion, clipping, and re-chunking. Never relabel a provider's 24/48 kHz bytes
as 16 kHz. Other encodings/rates/channels/durations fail negotiation; add a new negotiated version
to support them later.

One complete binary WebSocket message contains exactly one 24-byte header followed by exactly
640 payload bytes (664 total). All multibyte **header** integers are unsigned **big-endian**:

| Offset | Bytes | Field          | Required value                              |
| ------ | ----- | -------------- | ------------------------------------------- |
| 0      | 2     | Magic          | ASCII `OH` = `0x4f48`                       |
| 2      | 1     | Version        | `1`                                         |
| 3      | 1     | Kind           | `1` input, `2` output                       |
| 4      | 4     | Stream ID      | Nonzero negotiated/start stream identifier  |
| 8      | 4     | Turn sequence  | Positive current turn sequence              |
| 12     | 4     | Chunk sequence | 0-based contiguous index within this stream |
| 16     | 4     | Payload length | `640` = `0x00000280`                        |
| 20     | 4     | Reserved       | `0`; unknown flags/extensions rejected      |
| 24     | 640   | PCM payload    | Exactly one chunk                           |

Golden input header for stream `0x01020304`, turn 1, sequence 0:

```text
4f 48 01 01 01 02 03 04 00 00 00 01 00 00 00 00 00 00 02 80 00 00 00 00
```

Use `encodeOpenHuliAudio` and `parseOpenHuliAudio`. If the WebSocket library delivers fully assembled
messages (usual), pass each complete binary message directly. If it exposes decoded payload
fragments, use `OpenHuliAudioMessageDecoder.push(fragment, endOfMessage)`, preserving the WebSocket
FIN boundary. It buffers at most 664 bytes and emits only on FIN. It rejects short messages,
concatenated frames, payload/header length mismatches, unknown version/kind/reserved fields, and
zero IDs. Call `finish()` on disconnect to detect incomplete fragmentation. This decoder is not a
raw RFC 6455 parser: the transport owns masking, control frames, UTF-8 validation, TLS, and framing.
