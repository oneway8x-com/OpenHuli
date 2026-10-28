# ESP32 push-to-talk voice firmware

## Goal

Implement the configurable microphone-only reference for [#15](https://github.com/oneway8x-com/OpenHuli/issues/15).
Physical acceptance requires a confirmed ESP32-S2 Mini and microphone; do not claim it from simulator tests.

## Notes

- Project 3 In progress verified before editing; branch `15-esp32-voice-firmware` from main `2906eee`.
- User approved a general microphone/button/indicator profile first. No GPIO assignments or microphone model
  have been confirmed, and no USB serial board is present. Keep local credentials and unverified pins unset.
- Pinned PlatformIO/Arduino-compatible ESP32-S2 build with bounded PCM capture, verified WSS, explicit
  commit/cancel, fresh sessions on reconnect, and host protocol tests against the shared v1 contract.
- Portable C++ core owns framing/state/bounds; the adapter owns I2S/Wi-Fi/TLS. No provider key, speaker or telemetry claim.
- Existing `esp32-voice` requires ping. Add a strict `esp32-microphone` profile and owner UI option so pairing
  does not advertise unsupported MQTT commands. Existing profiles keep their requirements.
- A short non-final I2S read aborts instead of padding every chunk and misrepresenting its sample rate;
  only a final short chunk may be zero-padded. Congestion/read/send failures cannot commit partial input.
- Self-review covered core/adapter cancellation and generation fencing, bounded fragment/ID history,
  CA/hostname verification, disabled library debug output, truthful capability selection and secret-free defaults.

## Verification

- Passed: dependency install, Prisma generation, `pnpm typecheck`, `pnpm test` (374 unit + 7 script tests),
  Prisma validation, architecture and prompt guards, full application/runtime build.
- Passed: integration suite (108 tests) with migrations on a newly created disposable local PostgreSQL 17 database.
  No development/remote database was mutated.
- Passed: lint (0 errors, 98 existing warnings); source formatting and diff checks.
- Passed: portable C++ assertions and actual emitted JSON/binary conformance through the shared TypeScript v1 peer.
  Native coverage includes 20 logical turns, cancellation/disconnect, size/history/sequence limits, debounce
  rollover, PCM clipping/endian framing and fragmented input. These are not 20 hardware turns.
- Passed: ESP32-S2 cross-build. Inert image: 65,968 bytes static RAM / 622,690 bytes flash.
  A separate synthetic enabled configuration also linked: 78,664 bytes RAM / 856,078 bytes flash.
  Synthetic local header was removed; nothing was uploaded. Linker sizes do not establish runtime headroom.
- Passed: all 5 affected device Playwright journeys, including persisted microphone-only pairing and
  absence of unsupported command controls. Corrected the test select locator to its accessible role.
  Inspected final 1440px desktop and 390px mobile screenshots; no horizontal overflow or clipped fields.
- Run local validate PR: false (no unified `validate:pr` script exists; individual checks above ran).
- Not run: hardware upload/capture, real WSS certificate rejection, live spoken forecast, radio/heap/stack
  measurements and 20 physical turns. Docker-backed deployment/broker suites were not run; local Docker was unresponsive.

## Remaining work / risks

Open a draft PR, retain issue #15 In progress, and complete the explicit physical acceptance record before
calling the ticket done. Exact board/microphone identity, wiring, audio quality and stable memory under
Wi-Fi load remain unverified. Do not close #15 from host-native or cross-compilation results.
