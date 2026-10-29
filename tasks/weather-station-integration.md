# Weather station import and OpenHuli integration

## Goal

Bring the existing Weather Station V1 code into OpenHuli with a clear folder layout and connect
its actual indoor measurements and display to the existing device system.

## Notes

- No issue supplied. Branch `codex/weather-station-integration` starts from current `main`,
  verified equal to `origin/main` at `02fb788`. Preserve the unrelated docker-startup diary.
- Keep firmware in `firmware/weather-station`, wiring and enclosure sources in
  `hardware/weather-station`, and shared transports in `libraries/OpenHuli`.
- Preserve the online station, hardware/LCD diagnostics and earlier clock variant separately.
  The online station uses outer-row GPIOs 3/5/7/12/33/35 and sensor GPIO37.
- Reuse the existing weather-station profile, scoped MQTT identity, TLS client, telemetry,
  presence and command receipts. Never publish downloaded outdoor forecasts as room measurements.
- Import source, synthetic tests, public weather CA roots and design previews. Exclude local
  credentials, runtime logs, machine-specific verification records, duplicate meshes and generated
  print/CAD/PDF exports. The original project remains unchanged.
- Self-review traced sampling through the library's manifest/telemetry/presence/command lifecycle,
  existing profile and Tenant-scoped ingestion. Checked display ownership and timeout, durable
  reservation before effects, original sample timestamps, offline loss and separate forecast data.

## Verification

- Passed `pnpm typecheck`, `pnpm --filter @corely/data exec prisma validate`, `pnpm arch:check`,
  `pnpm build`, and `pnpm lint` (0 errors, 98 existing warnings).
- Passed both online ESP32-S2 normal/cloud-check builds and separate offline sensor/LCD,
  LCD-only and earlier-clock builds with PlatformIO 6.2.0. The cloud-check image links the
  shared library. These are cross-builds, not physical acceptance or measured runtime headroom.
- Passed cloud-check rebuild with deliberately compile-failing private cloud/Wi-Fi headers;
  both were ignored and then removed. ELF symbols confirm the real client, publisher, display
  callback and NVS reservation are linked (52,880 bytes static RAM / 946,546 bytes flash).
- Passed the new TypeScript/native contract test under Node 22.21.1 and GCC in WSL, covering
  fresh indoor-only values, failed reads, recovery, disconnected sample loss, no clock/no replay,
  publishing cadence/timer wrap, ASCII display bounds, padding and temporary-message expiry.
- Passed imported readout/display host tests and the actual ArduinoJson weather parser/cache/
  retry/forecast-day/Berlin-DST test with strict C++17 warnings under WSL.
- Ran `pnpm test` on Windows: script suite stopped with missing `c++`, `openssl`, `sh`, plus an
  existing packaging newline assertion. The new affected test passes with the WSL toolchain.
  Separately ran the full Vitest workspace: 373 passed, 5 skipped, 2 failed and 2 suites failed
  in unchanged runtime signal/serial tests (Windows SIGTERM exit semantics and missing compiler).
- WSL full script rerun: 17 passed, 6 unrelated failures in unchanged tests: old Docker Compose
  rejects the top-level name, CRLF shell/library metadata, and production-config child timeouts
  against the Windows checkout. No assertions were weakened or unrelated behavior changed.
- Passed changed-source Prettier/clang-format checks, Python syntax compilation, local Markdown
  links, staged line-count/diff checks and private-header/generated-output exclusion checks.
- Not run: database/broker/browser integration, live provider calls, physical upload, electrical
  checks, real MQTT/TLS or one-hour combined endurance. No server flow/schema changed.

## Remaining work / risks

Commit, push and create PR after final review. Broad tests need a supported Unix checkout/toolchain
or hosted CI. Physical module voltage compatibility, real broker/display effects, power-cut recovery
and endurance require separate hardware acceptance. Enclosure scripts were syntax-checked only;
CAD/render/PDF exports were not regenerated, and V2 manual slicer edits were not imported.
