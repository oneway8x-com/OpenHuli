# ESP32 weather telemetry and commands

## Goal

Implement the general reference for [#16](https://github.com/oneway8x-com/OpenHuli/issues/16): DHT11 sampling,
TLS MQTT presence and bounded acknowledged commands, composable with push-to-talk or as a sensor-only node.

## Notes

- Draft PR: [#47](https://github.com/oneway8x-com/OpenHuli/pull/47), stacked on #45. Hosted CI pending.
- Project 3 status changed to In progress and verified before edits.
- Branch `16-esp32-weather-firmware` starts at `ddced06`, the current #45 microphone firmware head.
  Keep the PR stacked on #45; do not merge the dependency or claim its pending hardware acceptance.
- No confirmed DHT11 GPIO, display interface, pin allocation or USB power setup. Keep defaults disabled.
  User confirmed an LCD1602 with a 16-pin parallel header. Add an opt-in 4-bit HD44780-compatible
  adapter, keeping pins unset and a separate confirmation flag. Absent hardware returns unsupported.
- Use bundled ESP-IDF RMT/MQTT drivers instead of adding dependencies: pulse capture avoids a sensor
  bit-banging interrupt blackout, MQTT runs off the voice loop, and retained commands are distinguishable.
- Commands require synchronized UTC, short valid lifetimes, local capability/size checks, exact identity
  deduplication and a fresh connection watermark rejecting pre-reconnect commands. Before effects, commit
  an NVS expiry guard that fences old commands after restart. Never replay uncertain work.

## Verification

- Passed: install, Prisma generation, full typecheck, `pnpm test` (374 unit + 13 script tests),
  Prisma validation, architecture/prompt guards and full application/runtime build.
- Passed: lint (0 errors, 98 existing warnings), scoped formatting, C++ formatting and diff checks.
- Passed: host-native pulse decoding, sensor failures, packet bounds/retained rejection, clock drift,
  expiry/duplicates/conflicts/capacity, display capability and persistence/reboot tests. Actual emitted
  MQTT messages pass the shared TypeScript schemas, including combined, sensor-only and absent-display manifests.
- Passed: the actual ArduinoJson command parser compiled with C++17 and strict warnings, using the same
  native recipe as firmware CI. Tests reject malformed/wrong-target/type/timestamp/NUL/oversized commands.
- Passed: both ESP32-S2 cross-builds. Default image: 65,976 bytes static RAM / 624,138 bytes flash.
  All-adapter link check: 102,580 bytes RAM / 943,154 bytes flash; verified weather worker, MQTT and LCD
  symbols remain linked. This is not measured runtime headroom. No board was flashed and no credentials or GPIO assignments were provisioned.
- One initial test run raced shared-package generation and could not resolve `@corely/prompts`;
  it passed after package generation finished. An initial link-check linkage issue was fixed before final builds.
- Passed: link-check ignores a temporary compile-failing local provisioning header and retains disabled
  defaults. The test header was removed; CI link-check always uses the example configuration.
- Run local validate PR: false (no unified `validate:pr` script exists; individual checks above ran).
- Not run: database/broker/browser integration or paid provider calls; no application flow/schema changed.
  No physical audio/sensor/display, TLS-on-board, USB power, outage or one-hour mixed-run result is claimed.

## Remaining work / risks

Self-review covered input boundaries, exact device/capability matching, bounded queues, TLS, reconnect
presence ordering, monotonic expiry, persistence before effects, optional GPIO initialization and no offline
replay. NVS stores an expiry guard, not proof of a physical result. Physical DHT11 accuracy,
I2S/sensor/radio timing, optional real display and one-hour mixed run require confirmed hardware.
