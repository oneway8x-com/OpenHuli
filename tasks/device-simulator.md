# Paced device simulator

## Goal

Implement [#12](https://github.com/oneway8x-com/OpenHuli/issues/12): shared-protocol audio/MQTT simulation,
a deterministic voice-to-HTTP scenario, and an explicit opt-in live-provider flow without hardware.

## Notes

- Branch `12-device-simulator` fast-forwarded to main `d81c8e0`. #9/#10/#11 are on main; no open PR or
  other simulator work found. Project status verified In progress before edits.
- Reuse the authenticated playback client, binary framing, command receiver, registered HTTP tools,
  durable executor and actual notes service. Mock AI/forecast must be labeled; no mock production mode.
- Never reconnect/replay an interrupted voice turn or automatically repeat uncertain external writes.
- The mock fixture uses guarded local test persistence, real pairing/grants/owner consent/execution,
  and an actual temporary notes HTTP service. AI/forecast bytes alone are synthetic.
- The shared playback client now accepts bounded recorded PCM, keeps terminal tool states after
  approval progress, and reports correlation/pacing without printing public response text by default.
- MQTT companion reuses the shared command receiver, bounded 3-second publish/subscription waits,
  scoped topics and a new boot per invocation. `mqtt-packet` is an already-installed codec declared
  as a test-only dependency for real TCP/MQTT packet tests; no new npm runtime dependency.

## Verification

- Frozen offline install passed. `pnpm typecheck` and final runtime typecheck passed.
- `pnpm test`: 359 unit tests plus script checks passed. `pnpm test:int`: 94 PostgreSQL integration
  tests passed, including the deterministic paced voice-to-HTTP/playback journey and interruption cases.
- `pnpm build`, full lint (98 existing scaffold warnings; none in changed files), Prisma validation,
  architecture and prompt guards passed. An overlapping build/test attempt raced generated contracts;
  ordered reruns passed without code/check weakening.
- CLI mock, cancel, disconnect and help passed. A temporary raw PCM file streamed exactly ten frames;
  normal mock used twenty paced frames, two successful correlated executions and exactly one HTTP POST.
  Interrupted mocks produced no tool executions or notes POSTs. Fixture Tenant cleanup verified.
- TCP/MQTT tests cover scoped configuration, stale/duplicate samples, unsupported display, delayed
  duplicate receipts and bounded missing-ack shutdown. Added shipped-client coverage to the real
  Mosquitto suite/CI; local Docker daemon did not respond, so that suite was not run here.
- Live-provider key is not configured in this process; no paid live provider, physical hardware,
  acoustic output, deployed TLS or browser E2E was claimed. The documented live gate includes owner
  inspection of matching actual API receipts and optional final public response output.
- Changed-file formatting, document links and diff whitespace checks passed. Complete diff self-reviewed
  for credential/endpoint boundaries, Tenant-scoped fixture cleanup, input/output pacing, cancellation,
  uncertain command receipts and separation from production startup. Final affected CLI/MQTT tests
  and runtime typecheck also passed after making broker disconnects unsuccessful.

## Remaining work / risks

Live provider smoke requires a locally paired device, recorded PCM and explicit opt-in; no provider
key belongs in device configuration or fixtures. Actual Mosquitto client coverage is pending CI.
Software pacing/playback does not establish physical device behavior. Published
[PR #39](https://github.com/oneway8x-com/OpenHuli/pull/39) from `12-device-simulator` into `main`;
GitHub CI pending at handoff. Owned test PostgreSQL cluster stopped and removed. No merge/deployment.
