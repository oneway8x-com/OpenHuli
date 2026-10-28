# Acknowledged device commands

Issue #14 adds `device.ping` and optional `display.message` to the existing registered executor.
Commands use the existing DeviceCommand table and authenticated MQTT connection; they do not introduce
another execution ledger. A successful MQTT write or broker acceptance never means the device acted.
Only an authenticated, timely device execution result can confirm success.

## Enablement and request flow

Enable the existing [authenticated MQTT telemetry mode](MQTT_TELEMETRY.md). Set
`RUNTIME_COMMAND_ACK_TIMEOUT_MS` (default 5000, range 100–15000). The same broker/server credentials,
private auth bridge, TLS verification and device topic ACLs apply. No separate command token or
model-selected destination is accepted. With MQTT telemetry disabled, the live conversation factory
does not register command tools. Broker/backend readiness and fresh, current-backend presence are
required; retained online state cannot establish a live target.

The device must have owner-configured **and advertised** `ping` or `display` capability. Display
text is 1–512 characters and cannot exceed the target's advertised maximum. Unavailable display,
excess text, offline/stale connectivity and an unready broker fail explicitly before publishing.
There is no queue that is drained on reconnect.

AI-originated requests need a current exact-target tool grant for the originating device. Both tools
are writes with one dispatch attempt. Low-risk owner preauthorization is still required by the shared
executor, or an exact per-execution approval; pairing and device grants alone do not grant consent.
The policy ID/revision, source device and target must match that consent. For current live AI turns,
configure low-risk owner preauthorization before requesting the command: interactive approval/resume
is #18, and an approval notice on a completed turn does not dispatch an action. See
[authorized execution](../architecture/authorized-tool-execution.md) and [device pairing](DEVICE_PAIRING.md).

The flow is:

1. Server composition creates `createDeviceCommandTools` with command repository, paired-device
   access, telemetry presence and an explicit publisher port.
2. AI and manual **owner** callers use `submitToolCall` / `dispatchToolExecution` with their verified
   authentication and an active committed conversation turn. The tools call `dispatchDeviceCommand`;
   a route/UI must never publish MQTT or call the raw callback directly.
3. The command use case verifies a running executor-managed write with the exact authorized target,
   reserves the durable command ID (the stable execution ID), and conditionally claims dispatch once.
4. The backend publishes a bounded v1 envelope with IDs, action, issued/expiry time, `retain=false`,
   QoS 0 and MQTT 5 message expiry. QoS 0 deliberately avoids automatic reconnect retransmission;
   explicit execution receipts provide application confirmation. Devices should use clean sessions.
5. The tool waits for a matching device/execution/command receipt until its deadline. A device must
   send that receipt only after actually performing or definitively rejecting the action.

Manual conversation/owner UI is #18/#19. It must use the same tool registration and executor use cases,
not a second command implementation. Integration tests exercise both authenticated owner and device
callers against that same factory. The default persistent host composes command tools into the live
conversation factory when authenticated MQTT mode is enabled. No new unauthenticated HTTP or broker
surface is added.

## State and uncertainty

| Command state | Meaning                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| `prepared`    | Durable reservation; no dispatch has been claimed.                                 |
| `pending`     | Dispatch was claimed; publishing/physical outcome may be uncertain.                |
| `succeeded`   | Matching authenticated device receipt arrived within the command deadline.         |
| `failed`      | Unsupported/offline/not-sent or an explicit device failure, with a bounded reason. |
| `expired`     | The undispatched reservation expired, or the device explicitly rejected expiry.    |
| `cancelled`   | Cancelled before dispatch; no effect is claimed.                                   |
| `unknown`     | Dispatch may have happened but no timely definitive execution result is available. |

Missing receipts, transport errors after bytes may have been offered, cancellation after dispatch,
and an abandoned pending command after restart remain **unknown**. Expiry does not prove an action
was undone. `getCommandOutcome` lazily expires abandoned reservations and marks dispatched timeouts
unknown; neither it nor query-only reconciliation republishes. A repeated tool delivery returns its
existing durable execution; concurrent dispatch can claim once. An explicit manual retry under a new
execution ID is a different action and requires investigation/consent if the prior outcome is unknown.

Device results are accepted only on the exact device's `/results` topic using the broker-attested,
currently valid MQTT identity. Payload identity, Tenant spoofing, mismatched execution IDs, retained
receipts and invalid completion times fail closed. The completion timestamp must be no earlier than
issuance, no later than expiry, and no more than five seconds in the server's future. The backend's
receipt time must also be before expiry for a normal result. First terminal result wins.

Late/duplicate results never revive an unknown, expired or cancelled outcome or trigger another
physical action. The first late result can remain as bounded diagnostic evidence on the command
record. Owner query-only reconciliation may return a definitive result already recorded in time;
late evidence remains unknown for operator investigation. Failed tools can now return schema-validated
bounded output (for example `unsupported`/`offline`) without being reported as a successful effect.

On host shutdown, command lifetimes abort, pending work settles conservatively, and tracked command
and executor work drains before their database clients close. A database outage can still exceed the
host shutdown deadline; restart reconciliation remains conservative and never auto-publishes work.

## Firmware and simulator rules

The shared `OpenHuliCommandReceiver` in contracts is a TypeScript reference algorithm for the simulator;
this ticket does not claim ESP32 firmware or real display validation. Firmware must implement equivalent
rules:

- Bind commands to its configured device ID and permitted capabilities; never execute from an arbitrary
  topic or unvalidated JSON. Validate expiry immediately before starting the physical effect.
- Synchronize UTC time before enabling commands and maintain a monotonic time anchor. Reject commands
  while time is unknown, after a backwards clock jump, issued in the future or already expired. The
  reference rejects lifetimes over 30 s; the server issues at most 15 s. MQTT expiry supplements this
  device-side check; it does not replace it.
- Reserve the command ID and exact execution/action identity before invoking the effect. Concurrent
  duplicates share the original receipt, and conflicting reuse of an ID never executes.
- Keep pending/completed IDs through command expiry. The reference defaults to a bounded cache of 256 entries
  and rejects new work when full, rather than evicting a still-valid ID. Once expired, duplicates are
  rejected by the timestamp check, including after the cache entry is removed.
- Send `device.command.result` only after the action finishes. Publishing a command, receiving it,
  scheduling work or starting a display driver is not completion. Uncertain driver outcomes are unknown.
- Preserve a small durable execution journal if deduplication must survive a reboot. Without that journal,
  an unexpired duplicate after power loss may repeat an effect. Even a journal cannot universally prove
  exactly-once physical effects across a crash between effect and durable completion. Never auto-replay
  unknown work after boot; require fresh commands and synchronized time.

## Verification

Run the normal repository checks plus `pnpm test:int` against an explicit disposable local database.
The contract tests cover concurrent duplicate execution, ID conflicts, clock/expiry rejection, capacity,
optional display and uncertain effects. Database tests cover shared owner/device execution, first receipt,
late/wrong/retained results, exact target scope, offline/unsupported targets, timeout/cancellation and shutdown.

The existing real-broker suite now also tests command publication, matching acknowledgements, spoofed
result rejection, duplicate delivery causing one simulated physical effect, a successful display action
with lost acknowledgement remaining unknown, offline failure and reconnect with no replay:

```sh
docker build -t openhuli-test-mosquitto docker/mosquitto
TEST_MQTT_BROKER_IMAGE=openhuli-test-mosquitto pnpm test:broker
```

Both commands additionally require the documented local `TEST_DATABASE_URL`. This uses synthetic
clients and the reference receiver, not physical hardware or paid AI calls. Public MQTT TLS, verified
firmware wiring and the standalone device simulator remain their own tickets.
