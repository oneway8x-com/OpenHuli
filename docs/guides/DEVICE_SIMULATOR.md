# Device simulator and voice-to-HTTP scenario

Issue [#12](https://github.com/oneway8x-com/OpenHuli/issues/12) adds a TypeScript client for the same
paired credentials, v1 manifests, WebSocket audio frames and MQTT topics used by firmware.
It runs without ESP32 hardware. It does not simulate physical microphone fidelity or speaker output.

## Deterministic mock scenario

From the repository root with the declared Node/pnpm versions:

```sh
pnpm install --frozen-lockfile
# Start only the development PostgreSQL service; a local PostgreSQL instance also works.
docker compose -f docker-compose.local.yml up -d postgres
export TEST_DATABASE_URL=postgresql://openhuli:openhuli@127.0.0.1:5434/openhuli_test
pnpm test:db:setup
pnpm build:packages
pnpm simulate --mock
```

The database guard requires an explicit loopback `openhuli_test` database before any fixture writes.
The command creates a disposable Tenant, owner session, paired voice device, scoped credentials,
exact tool grants and fixture-owner consent. It starts an authenticated loopback voice runtime and
separate notes HTTP API with temporary SQLite persistence. It removes only its own fixture rows/files
on normal completion, error or Ctrl-C. Forced process termination may leave synthetic Tenant data;
never use this command against a shared database. Mock startup is separate from production startup.

Twenty synthetic silent PCM frames are sent at 20 ms intervals. A scripted AI adapter requests
`weather.forecast` and `notes.create` after commit. Forecast bytes are a fixed synthetic fixture;
notes goes through a real HTTP POST and persisted receipt. Both run through the actual shared durable
executor, not a success stub. One software-paced response audio frame is consumed before its playback
receipt. There is no transcription or cloud AI call in this mode.

JSON output labels `mode: mock`, scripted AI, synthetic forecast and the actual local notes POST count.
It reports server conversation ID (`sessionId`), client turn ID, execution IDs/statuses, input pacing,
response character count and software playback frames. Matching execution IDs in the evidence link
the request, persisted API receipt and wire response. Credentials, full notes, raw audio and transcripts
are not printed by default. `--show-response` explicitly prints the bounded final public response,
which may contain user content; keep that output private. `pnpm simulate --help` lists the three modes.

## Recorded input and opt-in live provider

Use a dedicated synthetic device and notes destination for write tests. Follow
[pairing](DEVICE_PAIRING.md) to save the **one-time pairing response** to a private local JSON file.
The simulator reads `device.id`, `device.capabilities` and purpose-specific entries in `credentials`;
MQTT additionally needs the issued `mqttUsername`/`mqttClientId`. Rotate older credentials to obtain
these fields. Keep the file outside Git and restrict its permissions, for example `chmod 600`.
Do not add cloud API keys to this file. Provider keys stay on the runtime host.

Configure/start the runtime using [live conversations](LIVE_CONVERSATIONS.md),
[HTTP tools](HTTP_TOOLS.md) and, for companion telemetry/commands, [MQTT telemetry](MQTT_TELEMETRY.md).
Enable an actual location for `weather.forecast` and a real configured notes demo API for `notes.create`.
Grant both tools to the source device. Notes also requires fixture-owner preauthorization or exact
owner approval through the shared executor; a device grant alone cannot authorize the POST.
The owner console can approve the pending execution within the configured turn deadline.

Record a short utterance asking for the forecast and/or a clearly synthetic note. Convert it to raw
16 kHz, PCM16 little-endian, mono audio, without a WAV header. Files must contain 1–500 complete
640-byte/20 ms frames (at most ten seconds). The simulator rejects partial frames instead of guessing
sample rate or trimming a recording. For example, an existing recording of at least four seconds can
be converted with `ffmpeg -i input.wav -t 4 -ar 16000 -ac 1 -f s16le input.pcm`.

```sh
# Explicit opt-in: this contacts your configured runtime and may incur provider cost / create a note.
pnpm simulate --live --config /private/device.json --pcm /private/input.pcm \
  --endpoint wss://runtime.example.test/voice --show-response
```

Use real hostnames/paths in place of the examples. Non-loopback connections require verified WSS;
there is no insecure TLS option. Development loopback `ws://127.0.0.1:3200/voice` is accepted.
The client sends audio continuously while the recording plays, then commits once. It consumes text
and audio events, uses a bounded playback queue and acknowledges only completed sink consumption.
Its sink is software timing, not an acoustic speaker. It never reconnects or replays a turn.

For a live acceptance record, keep the reported conversation/turn/execution IDs. In the authenticated
[owner console](CONVERSATION_CONSOLE.md), select that conversation and verify each matching tool:
`weather.forecast` must have an attributed, dated real forecast result, and `notes.create` must have
its persisted note ID/receipt at the intended API. Confirm the final response printed with `--show-response` and any software playback
receipt for that same turn. Repeat with the other recording if using separate forecast/notes utterances.
The client reports only execution statuses, not private tool outputs: a completed socket turn alone
is **not** proof that the intended forecast/notes API ran. Live output explicitly requires correlated
owner-execution inspection. Mock success never counts as this live acceptance gate.

## MQTT companion and reproducible faults

Provision the required temperature/humidity/ping capabilities; add microphone/speaker for voice and
an optional configured display. Run the companion alongside voice or manual owner commands:

```sh
pnpm simulate --device --config /private/device.json --mqtt mqtts://broker.example.test:8883 \
  --duration 60 --interval 30
# Development only: --mqtt mqtt://127.0.0.1:1884
```

This uses the paired MQTT identity/token, publishes its manifest, online presence and synthetic
22 °C / 55% readings, and subscribes only to its own exact command topic. Name the provisioned device
as a simulator so synthetic readings cannot be confused with physical measurements. The interval
must match the runtime freshness policy. The command receiver reuses shared capability, expiry,
clock and deduplication checks; a simulated display/ping effect never operates real hardware.
Work is bounded to 16 active command receipts and 256 dedupe entries. Connect/subscription/publish
waits are bounded; broker loss stops work without reconnect. Stop emits offline; unexpected loss uses
the offline Last Will. Every new invocation has a new boot ID. Duplicate receipts never repeat an effect
within the connection; cross-restart command replay is not supported and the server never auto-replays.

| Fault                   | Command option                                                  | Expected observation                                                                                                                                |
| ----------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancel input            | `--mock --fault cancel`, or `--live ... --fault cancel`         | Cancel halfway before commit; no tool dispatch for that incomplete turn.                                                                            |
| Disconnect input        | `--mock --fault disconnect`, or `--live ... --fault disconnect` | Abrupt close halfway; backend cancels, without reconnect/replay.                                                                                    |
| Unsupported display     | `--device ... --fault unsupported-display`                      | Advertise no display even if owner-configured; shared command policy/receiver denies display.                                                       |
| Duplicate delivery      | `--device ... --fault duplicate`                                | Repeat identical telemetry/receipts; persisted telemetry deduplicates and command effects do not repeat.                                            |
| Delayed acknowledgement | `--device ... --fault delayed-ack`                              | Delay receipts ten seconds; with the default five-second server deadline the command remains unknown. Late receipt cannot fabricate timely success. |
| Stale measurements      | `--device ... --fault stale`                                    | Sample time is four configured intervals old; presence can be online while data is stale.                                                           |

Live cancel/disconnect can still open a paid provider session; no tool dispatch does not mean zero
provider cost. MQTT fault flags require `--device`; input faults require a voice mode and at least two
input frames. `--duration` bounds companion lifetime to 1–300 seconds. Ctrl-C aborts input/output and
stops pending acknowledgements; cancellation cannot undo an externally accepted write.

## Verification boundaries

`pnpm test` covers the TCP/MQTT packet fixture, simulator input/endpoint validation and playback.
`pnpm test:int` covers paced input arriving before commit, real paired authentication and authorization,
actual local notes POST, correlated execution/response/playback, and cancelled/disconnected input.
`pnpm test:broker` additionally runs the shipped companion against actual Mosquitto and checks stale
and duplicated readings plus unsupported command receipts. See the MQTT guide for its Docker/image
setup. A packet fixture is not broker ACL evidence. These deterministic tests are not a live AI,
physical ESP32 or deployed TLS acceptance record. No provider key is committed or required for mocks.
