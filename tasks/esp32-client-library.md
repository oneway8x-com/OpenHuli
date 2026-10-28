# ESP32 Arduino/PlatformIO client library

## Goal

Implement [#48](https://github.com/oneway8x-com/OpenHuli/issues/48): an ESP32 telemetry and command
library, an installable Arduino/PlatformIO package, a minimal example and reference firmware reuse.

## Notes

- Project 3 **In progress** verified before editing. Branch `48-esp32-client-library` starts from
  `main` at `b9e46ea`; the original checkout was clean.
- Extracted the existing weather protocol, command parser/receiver and MQTT adapter into
  `libraries/OpenHuli`. DHT11, LCD, GPIO and voice remain in the reference firmware, which now uses
  the same client. No backend API, migration, environment variable or tenant policy change.
- Initial transport supports Arduino ESP32 2.0.17 / ESP-IDF 4.4, ArduinoJson 6.21.5 and C++11.
  PlatformIO and Arduino manifests share the same version/dependency. Voice is a follow-up.
- Added optional measured/error/omitted metrics, SDK subscription acknowledgement readiness,
  bounded input/queues/history, TLS validation, reconnect backoff, explicit result uncertainty and
  persisted expiry fencing. Display configuration requires completion and durable reservation callbacks.
- The minimal sketch reports unavailable sensors until a real driver is supplied; the reference
  retains its actual DHT11/LCD adapters. No fabricated measurement or offline replay.
- Self-review covered config lifetime, task ownership, input bounds, identity/target validation,
  connection generation checks before dispatch and after durable reservation, timestamp/expiry
  guards, package allowlists and reference callers. Kept the callback's 4 KiB scratch buffer off
  the MQTT stack. Strict command parsing also rejects trailing garbage after a JSON object.

## Verification

- Passed `pnpm typecheck`, `pnpm test` (374 unit tests and 21 script tests),
  `pnpm --filter @corely/data exec prisma validate`, `pnpm arch:check`, and `pnpm build`.
  Node 24.2.0 satisfies the declared Node >=22.19 engine; pnpm is the declared 10.26.0.
- Passed `pnpm lint`: no errors, 98 existing warnings in unchanged application/shared code.
- Passed affected native C++ protocol/firmware tests with TypeScript contract conformance,
  package metadata/ZIP assertions, actual ArduinoJson command parser tests, and C++11 client
  lifecycle tests with fake ESP32/MQTT/queue boundaries. Coverage includes SUBACK readiness,
  retained/wrong-topic input, bounded queues, duplicate/conflicting commands, storage failure,
  expiry, disconnect before/during effects, clock faults, and reconnect/reboot fences.
- Passed PlatformIO 6.2.0 ESP32-S2 cross-builds: reference `s2_mini` / `s2_mini_check` and
  library example `s2_mini` / `s2_mini_check`. Final protocol/transport edits rechecked with
  affected native tests and reference builds; the standalone ZIP example also cross-compiled.
- Passed `pio pkg pack` and Arduino ZIP creation/inspection (13 allowlisted files); the ZIP was
  unpacked into a temporary directory and its example built without the source checkout.
- Passed changed-source formatting and `git diff --check`. CI now builds/packages the library
  example and exercises the actual parser and client lifecycle. Hosted CI result is pending.
- No hardware upload, actual Arduino IDE session, physical TLS/clock/network/sensor/display tests,
  live provider calls, broker/database integration or E2E suite was run for this client extraction.
  Cross-compilation and fake boundaries do not establish those hardware/runtime results.

## Remaining work / risks

Implementation committed and pushed; [PR #49](https://github.com/oneway8x-com/OpenHuli/pull/49)
targets `main` and closes #48 on merge. Hosted CI is pending; the issue remains open.
Physical TLS/network/heap/stack/sensor/display acceptance
remains under [#22](https://github.com/oneway8x-com/OpenHuli/issues/22); core 3.x and other boards
are unsupported. No registry publication, deployment, release or remote database change was made.
