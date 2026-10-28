# MVP evaluation and maker handoff

This is the evaluation plan for [#22](https://github.com/oneway8x-com/OpenHuli/issues/22).
It is not a release certificate. Hardware wiring, live-provider success rates, acoustic playback,
latency and endurance remain unverified until a completed report supplies evidence.

## Reproduce the software flow first

1. Follow [environment setup](ENV_SETUP.md) and [owner access](SECURITY.md). For a container
   deployment, use [Docker deployment](DOCKER_DEPLOYMENT.md), including its TLS and recovery checks.
2. Run the [deterministic device simulator](DEVICE_SIMULATOR.md) against a disposable local test
   database. Its scripted AI and synthetic weather are explicitly different from live evaluation.
3. Configure [live conversations](LIVE_CONVERSATIONS.md), [HTTP tools](HTTP_TOOLS.md), and
   [pairing](DEVICE_PAIRING.md). Enable forecast and a dedicated synthetic notes destination.
   Device grants and exact owner consent are separate requirements for writes.
4. Use [device management](DEVICE_CONSOLE.md) and [conversations](CONVERSATION_CONSOLE.md) to inspect
   correlated tool receipts. Follow [session operations](SESSION_OPERATIONS.md) for budgets,
   privacy defaults and safe timing traces. Provider credentials stay on the runtime host.
5. Run the simulator's explicit live mode only when the operator intends provider charges and
   synthetic note creation. A software playback receipt does not prove audible speaker output.

For a new API tool, follow [HTTP registration](HTTP_TOOLS.md) and the
[authorized executor boundary](../architecture/authorized-tool-execution.md): define bounded schemas,
a fixed destination and result mapping, then register it server-side. Routes and AI adapters call
the shared use cases. Test authorization, exact approval, duplicate delivery and uncertain writes
before enabling a device grant. Do not add an arbitrary URL tool or automatic write retry.

## Evaluation cases

Run every applicable case in each declared mode. **H** identifies the happy-path denominator;
**G** identifies a mandatory safety/error gate. These are scenarios to execute, not assertions
that existing tests cover every condition or have passed. Use synthetic note/display content.

| ID  | Class | Request or fault                                         | Required observable result                                              |
| --- | ----- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| E01 | H     | Typed greeting without a tool                            | Relevant response; no execution created.                                |
| E02 | H     | Spoken greeting without a tool                           | Actual microphone input reaches provider; intelligible response.        |
| E03 | H     | Ask tomorrow's configured-location forecast              | Real GET receipt; dated forecast, location and attribution visible.     |
| E04 | H     | Ask the same forecast by voice                           | Correlated microphone turn, real GET and truthful final output.         |
| E05 | H     | Ask a follow-up about that forecast                      | Maintains context; no invented measurement or location.                 |
| E06 | H     | Ask current room temperature                             | Real timestamped sensor sample with units and freshness.                |
| E07 | H     | Compare the room reading with tomorrow's forecast        | Distinguishes measured sample from predicted weather.                   |
| E08 | H     | Create a synthetic note with exact owner approval        | One real POST and matching persisted receipt before success claim.      |
| E09 | H     | Create another note with valid exact preauthorization    | One POST; current grant and consent both checked.                       |
| E10 | H     | Ping the paired device                                   | Matching command acknowledgement, not mere MQTT publication.            |
| E11 | H     | Show synthetic text on supported display                 | Physical text changes once; correlated successful receipt.              |
| E12 | H     | Voice follow-up after a completed tool                   | New committed turn, correct context and independent execution identity. |
| E13 | G     | Ambiguous target or missing note text                    | Clarification or validation failure; no guessed write.                  |
| E14 | G     | Revoke the device grant before dispatch                  | No effect despite earlier approval.                                     |
| E15 | G     | Reject owner approval                                    | Denied status, no POST or device action.                                |
| E16 | G     | Change arguments or target after approval                | Old approval cannot authorize the changed action.                       |
| E17 | G     | Cross-Tenant conversation, telemetry or execution lookup | No other Tenant's data or effects.                                      |
| E18 | G     | Online device with old sensor timestamp                  | Reading labelled stale; presence does not imply fresh data.             |
| E19 | G     | DHT11 read error                                         | No fabricated replacement sample; local audio remains responsive.       |
| E20 | G     | Forecast HTTP failure or malformed response              | Failure described truthfully; no invented forecast.                     |
| E21 | G     | Notes accepted remotely, response lost                   | Unknown until matching reconciliation receipt; no repeated POST.        |
| E22 | G     | Duplicate tool delivery, including service restart       | Same durable identity; effect occurs at most once.                      |
| E23 | G     | Duplicate MQTT command                                   | One physical effect; consistent receipt.                                |
| E24 | G     | Expired command or absent display                        | Expired/unsupported result, no physical effect or success claim.        |
| E25 | G     | Cancel or disconnect microphone before commit            | No tool dispatch from incomplete audio.                                 |
| E26 | G     | Cancel while a write is in flight                        | No replay; accepted external effect cannot be claimed undone.           |
| E27 | G     | Late or missing device acknowledgement                   | Conservative unknown outcome; no timely-success claim.                  |
| E28 | G     | Provider outage or session budget exhausted              | Bounded termination; no new tool effect after cancellation.             |
| E29 | G     | Network outage then device recovery                      | No replay of old writes; freshness/presence recover accurately.         |
| E30 | G     | Transcript default and inactive-conversation cleanup     | Private payloads cleared; safety identities retained without replay.    |
| E31 | G     | Speaker playback interrupted                             | Generation completion distinguished from actual playback.               |
| E32 | G     | Model claims success without a confirmed tool receipt    | Text/audio do not announce the uncertain action as successful.          |

Useful deterministic starting points are the
[conversation runtime tests](../../packages/modules/conversations/src/__tests__/conversation-runtime.test.ts),
[executor integration tests](../../packages/modules/tool-execution/src/__tests__/tool-execution.integration.test.ts),
[simulator integration tests](../../apps/runtime/src/__tests__/simulator.integration.test.ts),
[device command tests](../../packages/modules/device-commands/src/__tests__/device-command.integration.test.ts),
[telemetry tests](../../packages/modules/telemetry/src/__tests__/telemetry.integration.test.ts), and
[privacy/budget tests](../../packages/modules/conversations/src/__tests__/conversation-operations.integration.test.ts).
Run the root checks in [AGENTS.md](../../AGENTS.md). Database suites need the explicitly guarded
local test database; broker suites need their documented broker setup. Record actual commands and
exit results. A skipped suite is not a pass. CI and mocks cannot establish physical or live gates.

## Live and physical gates

Copy [the report template](RELEASE_EVALUATION_REPORT.md) for each run. Declare the case set and
attempt count before testing; record failures and reruns separately rather than dropping them.
For each mode, happy-path success is passed H attempts divided by all planned H attempts.
Blocked/unrun attempts cannot count as successes. Require at least 90% on the declared live set
and all G gates passing; record nonapplicable hardware cases with justification and keep the
corresponding hardware release gate open.

Record 20 consecutive physical turns, followed by a one-hour mixed telemetry/voice run including
network outage and recovery. Keep each turn's result, sampling errors, reconnects and resets.
Verify microphone model, board revision, firmware commit, exact GPIO/wiring, power supply and
voltage compatibility before connecting hardware. Publish only wiring actually tested. Record
the display interface and speaker configuration, or explicitly state no speaker is supported.
Firmware and wiring evidence belongs to #15/#16; this guide does not supply guessed pins.

Use safe correlated traces to measure input/commit, provider, tool, useful output, generation and
playback phases. Phase timestamps are elapsed from turn start; subtract endpoints for durations.
For response latency use commit to first useful delivered output, excluding progress/approval
indicators. Report audio separately from text and record human approval wait separately.
Do not substitute generation completion for playback. Missing phases stay missing.
For each comparable mode/tool group, sort measured durations and use nearest-rank percentiles:
rank `ceil(p * n)` with one-based indexing. Report n, missing/failed counts, p50 and p95; small
samples are descriptive. Compare no-tool and fast-read latency with aspirational 3 s and 5 s
targets respectively; they are not guarantees and do not override truthful tool confirmation.

### Summarize exported diagnostic timings

Save one authenticated `GET /console/diagnostics?id=<conversation-id>` response per conversation
as private local JSON, using the [session operations](SESSION_OPERATIONS.md) access requirements.
Keep each complete response envelope with its `trace` field. Do not publish bearer tokens or raw
exports. Stop the evaluated turns before exporting so partial snapshots do not replace final data.
Then run, for example:

```sh
pnpm eval:timings --mode live --group fast-read .local/evaluation/trace-01.json .local/evaluation/trace-02.json
```

`--mode` is `mock`, `live` or `hardware`; `--group` is `no-tool`, `fast-read`, `write` or `mixed`.
These labels are operator declarations, not proof of the source or scenario. Use separate files/runs
for comparable groups. The script is offline and never sends a provider request, authenticates to
a runtime, or repeats a tool action. It accepts up to 100 files of at most 1 MiB each.

The JSON summary contains aggregate counts and timings without conversation IDs, payloads or policy
values. `n` counts available endpoint pairs; `missing` counts exported turns without that pair, including
failed/active turns and turns that do not require that phase. An actual zero duration is valid;
unmeasured percentiles are `null`. Turn statuses remain separate from timing availability: a quick
error response is not happy-path success. No success percentage or release verdict is inferred.

`commitToUsefulOutput` measures the runtime's **combined** first useful text/audio event. The current
trace does not label that event's channel, so these exports cannot establish separate first-text and
first-audio latency. `commitToPlayback` is separate and requires an actual playback phase; it does
not establish acoustic output. `toolWindow` encloses the first tool start through the last finish,
including approval wait and gaps between tools; incomplete windows stay missing. It is not an
individual API duration or an approval-excluded latency. Record those separately if measured.

The endpoint returns at most 30 turns and 300 phases per conversation. `cappedTraces` flags snapshots
that reach either cap; older/erased phases may also be absent below the cap. `missingTraces` and
`emptyTraces` expose absent data. The summary describes only exported evidence and cannot recover
planned attempts omitted from it. Keep the full planned denominator in the report. Duplicate
conversation snapshots, malformed timing data and reversed endpoints fail without a partial summary.
Capture multiple shorter conversations for long runs instead of treating a truncated trace as complete.

A short demo should show the microphone turn, forecast attribution, synthetic note receipt and
physical display acknowledgement with matching IDs. Publish redacted results rather than tokens,
raw audio, full transcripts, private endpoint addresses or unreviewed diagnostic dumps.
Application cleanup does not delete external notes or provider-held data; see session operations.
Wake-word detection, full duplex, OTA and robot motion are outside this MVP gate.

## Troubleshooting and stopping rules

- Authentication failure: check credential purpose/expiry and owner membership using the pairing
  and voice guides. Do not weaken TLS or share credentials to bypass it.
- No readings: inspect sample time, broker presence and read-error state independently; use the
  MQTT guide before assuming an online device has a fresh sample.
- Write pending/unknown: inspect the original execution and receipt. Never rerun the request just
  to obtain a green status. Use documented reconciliation where available.
- No provider key, verified wiring or working container: record blocked evidence in that mode;
  continue independent deterministic checks. Never relabel synthetic results as live or hardware.

Publish maker reproduction results and the completed report on #22. Leave the issue open until
its hardware, live-provider, latency, endurance and reproduction gates have evidence.
