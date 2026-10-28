# Flexible Uno/Nano device clients

## Goal

Implement [#50](https://github.com/oneway8x-com/OpenHuli/issues/50): one small AVR API through a
USB computer bridge or standalone ESP-01 Wi-Fi gateway, preserving existing ESP32 clients.

## Notes

- User approved implementation. Selected dedicated ESP-01 firmware, one AVR per gateway, manual
  route switching, and existing v1 sensor/ping/display capabilities. Project 3 In progress verified
  before edits; branch `50-flexible-device-clients` from main `bf7fe6f`.
- Added `OpenHuliSerial`: fixed-size binary framing, two-slot EEPROM boot journal, fresh challenged
  sessions, bounded sensor/error messages, one synchronous physical command and cached receipts.
  The same Stream API and wire protocol serve USB and ESP-01. No cloud secrets or heap hot path on AVR.
- Added a separate production USB CLI in runtime, private pairing/config parsing, an exclusive
  fsynced expiry fence, exact-topic MQTT TLS and command receipts from the real local protocol.
  SerialPort 13 is the only new Node boundary dependency; it ships native OS bindings. Kept the
  lockfile changes scoped to its dependency graph and allowed its native build hook explicitly.
- Added credential-free inert/default and link-check ESP-01 firmware targets, BearSSL TLS 1.2,
  ArduinoMqttClient with retained/SUBACK checks, LittleFS expiry fencing, guarded UTC and reconnects.
  Shared v1 codecs remain in OpenHuli; its direct transport remains ESP32-only and compatible.
- Added the sensor-node pairing profile (ping required, optional real sensors and <=32 ASCII display),
  matching UI controls and backend restrictions. No migration, new environment variable, provider,
  arbitrary GPIO capability, new cloud endpoint or authorization bypass.
- Online state follows an actual AVR handshake/heartbeat. Gateways refresh presence for sensorless
  nodes and use a terminal offline/Will sequence within each fresh cloud boot. No offline replay.
- Self-review fixed live clock reads after TLS/storage work, shutdown draining before unlocking
  dispatch state, bounded outstanding broker work, duplicate heartbeat handling and explicit
  offline evidence. Added Docker exclusions for private device headers and embedded build outputs.
- EEPROM corruption fails closed; no automatic EEPROM/filesystem reset. Exact UART/power/module
  choices and firmware upload still require confirmed attached hardware.

## Verification

- Passed frozen dependency installation, root `pnpm typecheck`, `pnpm test` (380 unit + 22 script
  tests), Prisma validation, architecture guard, and final `pnpm build`. Runtime and E2E typechecks
  were also rerun after final TypeScript edits. No remote database was touched.
- Passed full lint (0 errors, 98 existing warnings); affected-code lint, changed-source formatting,
  C++ formatting, package checks and `git diff --check`.
- Passed 108 integration tests on a newly initialized disposable loopback PostgreSQL 17 database.
- Passed five existing device browser journeys and the new sensorless pairing journey. The first
  new run exposed a test locator mismatch; corrected it to the existing exact combobox role and
  reran successfully. Inspected 1440 px desktop and 390 px mobile screenshots after reload, with
  one-time credentials removed. No clipping/overflow in the changed controls.
- Passed native node/gateway exchange, CRC/fragment/bounds checks, EEPROM interrupted-write
  recovery, duplicate/stale-session/reboot rejection, wraparound deadlines and the <=512-byte
  native node state assertion. TypeScript and C++ agree on serial wire fixtures.
- Passed production USB adapter test through an OS PTY, actual C++ node, synthetic MQTT broker
  and verified TLS certificate. Also rejects an untrusted CA and retained commands. Native node
  receipts, journal reload/locking/corruption and disconnect-during-reservation tests pass.
  These fixtures do not prove a physical AVR or Mosquitto authorization behavior.
- Passed Uno/Nano Node and Sensors cross-builds (443 / 447 bytes total static RAM respectively),
  ESP-01 1 MiB inert/link-check builds and LittleFS image construction. ESP-01 link-check static
  RAM is about 35 KiB; this excludes dynamic TLS/filesystem buffers and is not runtime headroom.
- Passed existing ESP32-S2 inert/link-check cross-builds. Packaged the 15-file Arduino Serial ZIP,
  inspected its allowlist, unpacked it outside the checkout and built its Uno/Nano example.
- The initial app build overlapped a development browser server and lost a generated .next file;
  after the browser server stopped, the final standalone production build passed. No application
  workaround or weakened check was introduced.
- Not run: attached-board flash/serial capture, ESP-01 live broker/CA tests, real sensor/display
  effects, physical power cuts, stack/heap/fragmentation measurements or one-hour endurance.
  Hosted CI remains pending. No registry publication, release or deployment was made.

## Remaining work / risks

Push implementation and open a draft PR. Keep #50 In progress: its physical ESP-01 qualification,
confirmed module/flash/UART/power setup, runtime memory and endurance gates remain outstanding.
Do not mark the hardware support acceptance criteria complete from synthetic fixtures or builds.
