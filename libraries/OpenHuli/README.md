# OpenHuli Arduino client

An ESP32-first C++ library for OpenHuli v1 MQTT telemetry, presence, ping and optional display
commands. The reference weather firmware consumes this same library. Voice/WSS is a follow-up;
this package does not expose AI/provider credentials or owner provisioning APIs.

## Supported environment

- Arduino ESP32 core **2.0.17** / ESP-IDF 4.4; PlatformIO Core 6.2.0 and the pinned example platform.
- ArduinoJson **6.21.5**, the existing firmware dependency. No additional MQTT library: the ESP32
  core supplies ESP-MQTT. Device connections use MQTT 3.1.1; the OpenHuli broker adds authenticated
  MQTT 5 metadata for the backend subscriber, as with the reference firmware.
- Library sources support C++11. ESP32-S2 Mini (`lolin_s2_mini`) is cross-compiled in CI.
  ESP32 core 3.x / ESP-IDF 5, AVR/Uno/Nano and other boards are not validated/supported by this transport.
- Compilation does not establish physical TLS, GPIO, sensor, LCD or outage/recovery acceptance.
  Track those release checks in [#22](https://github.com/oneway8x-com/OpenHuli/issues/22).

## Install

For Arduino IDE, from the repository root:

```sh
python3 scripts/package-arduino-client.py --output /tmp/OpenHuli.zip
```

Use **Sketch → Include Library → Add .ZIP Library**, select the ZIP, and install ArduinoJson 6.21.5
if prompted. Select an ESP32 board with core 2.0.17, then open **File → Examples → OpenHuli → Telemetry**.
The ZIP uses an explicit allowlist; it excludes local configuration, tests and `.pio` output.
No registry publication is required. The complete monorepo ZIP is not an Arduino library ZIP.

For a project in this checkout, use a relative PlatformIO dependency:

```ini
lib_deps =
  OpenHuli=symlink://RELATIVE_PATH_TO_CHECKOUT/libraries/OpenHuli
```

The included example already resolves the local library:

```sh
cd libraries/OpenHuli/examples/Telemetry
cp config.example.h config.local.h
# Edit config.local.h privately, then:
pio run --environment s2_mini
```

The example pins its ESP32 platform/core/tools. When using the packaged ZIP outside this checkout,
extract it and point your PlatformIO dependency to the extracted `OpenHuli` directory. A monorepo
Git dependency does not automatically select its library subdirectory.

## Provision and configure

Create the device with the existing OpenHuli owner console. Provision the capabilities your sketch
will advertise: by default `temperature`, `humidity`, and `ping`. A display additionally needs its
owner-configured maximum text length. Capabilities never grant authority by themselves.

Copy the assigned device ID, **MQTT** username, client ID and MQTT-purpose token into private
`config.local.h`, together with the deployment's MQTT hostname, port and CA certificate. Use the
actual MQTT endpoint, which may differ from the console host. Tokens expire and can be revoked;
rotate/reprovision through the owner console, update the private device configuration and restart.
Never put owner cookies, voice tokens, provider keys, or the CA private key in a sketch or logs.

The adapter always uses verified TLS, hostname checking and a clean broker session. There is no
insecure/plaintext option. Configure a trusted UTC source before use; the example calls `configTime`
with an NTP server, whose trust must suit your network. Plausible NTP time is not authenticated time.
The clock guard waits for a sane UTC date (2024–2099), anchors to the monotonic ESP32 timer, and
latches closed on backwards jumps or drift over one second. Resynchronize and restart after a clock
fault. The library never starts Wi-Fi, selects pins, or configures time servers on your behalf.

## API

```cpp
#include <OpenHuli.h>

openhuli::OpenHuliClient huli; // Prefer a global/static object.
// In setup, fill a ClientConfig with the provisioned identity and CA, then huli.begin(config).
// In loop:
huli.loop();
if (huli.connected()) {
  openhuli::device::Telemetry sample;
  sample.temperature = {openhuli::device::SensorStatus::measured, measuredCelsius};
  sample.humidity = {openhuli::device::SensorStatus::read_failed, 0};
  huli.publish(sample, huli.now()); // Keep the real measurement timestamp if publishing later.
}
```

This illustrates API calls; `measuredCelsius` comes from your driver. See the complete
[Telemetry sketch](examples/Telemetry/Telemetry.ino). Its default `readSensors()` reports
`unavailable` for both metrics until you connect a real driver. A measurement is never fabricated.
The [reference weather firmware](https://github.com/oneway8x-com/OpenHuli/blob/main/firmware/esp32-voice/src/weather_runtime.cpp) provides the
existing DHT11 and optional parallel LCD example with board-specific validation.

- `begin(config)` validates configuration and allocates bounded state; false means no connection
  started. Configuration strings must remain alive and unchanged until `end()`. Use static strings
  or owned configuration storage, never temporary `String.c_str()` values.
- Call `loop()` frequently (the example yields 10 ms). It handles clock checks, connect/subscribe,
  bounded command dispatch, and reconnect backoff (1–30 s, 10 s connection/subscribe timeout).
  TLS/SDK calls may block up to their configured network timeout; it is not a hard real-time API.
- `connected()` requires an active TLS connection, subscription acknowledgement, online presence
  publication and valid clock. It does not establish backend/database/provider health.
- `publish(sample, sampledAt)` returns local transport acceptance, not server persistence. It rejects
  offline sends, empty samples, undeclared metrics, non-finite/out-of-range measurements, future
  timestamps and samples at least 60 s old. There is no offline sample queue or automatic retry.
- Metric states are `omitted`, `measured`, `read_failed`, and `unavailable`. Supported ranges are
  −40…125 °C and 0…100% humidity. Set `config.capabilities.temperature`/`humidity` false for absent
  capabilities and omit those metrics. Ping is always supported. `Reading` is a convenience form
  for a combined temperature/humidity reading or combined read failure.
- Publish fresh telemetry/errors at least every configured backend telemetry interval (30 s by
  default). Telemetry refreshes liveness; an idle ping-only connection eventually becomes stale.
- `end()` publishes offline presence when possible and destroys transport/queue state. Lost receipts
  or disconnections never trigger replay. A fresh `begin()` has a new boot ID.

Call all client methods from **one owning task**. Display/reservation callbacks execute synchronously
on that task and must not call back into the client. The MQTT task only assembles bounded packets
and queues at most two commands; one command is processed per `loop()`. Use a dedicated worker if
sensor/display/network calls would interfere with audio or other timing-sensitive work.

## Optional display and replay protection

Set `config.capabilities.display_characters` (1–128 ASCII characters), `config.display`, and
`config.reserve`. Display configuration requires both callbacks. `display(text)` returns
`device::Outcome::succeeded` only after the driver confirms completion; return `failed` for a
known failure and `unknown` if the effect may have occurred. Unsupported/non-ASCII text never
reaches the callback. This deliberately supports a narrower text subset than the server contract.

`reserve(expiresAt)` must durably save the greatest expiry **before** an effect and return false
on storage failure. On boot, load that watermark into `config.previous_boot_until`. The reference
firmware uses ESP32 Preferences/NVS. Keep the same journal across credential rotation and restarts.
Without durable state and a trusted clock, replay safety across reboot cannot be claimed.
A journal cannot prove exactly-once physical effects across a crash between an effect and receipt.

The client rejects retained/wrong-topic/wrong-device messages, malformed JSON, extra fields,
noncanonical timestamps, expired/future commands and lifetimes over 30 s. It accepts canonical
`YYYY-MM-DDTHH:mm:ss.sssZ` timestamps produced by OpenHuli. Commands from before the fresh
connection or persisted expiry fence cannot execute. Sixteen command IDs remain reserved through
expiry; capacity fails closed instead of evicting live IDs. Duplicates return the original result;
conflicting IDs never execute. Unknown outcomes and lost receipts must be reconciled server-side,
never blindly retried. A new boot/reconnect discards queued input and requires fresh commands.

## Limits and verification

Inbound commands are limited to 4 KiB (stricter than the server's 16 KiB protocol ceiling), JSON
depth 4, two queued commands, sixteen replay entries and 128 display characters. Queues/protocol
state use bounded heap storage, with an additional 8 KiB MQTT task stack and SDK TLS buffers.
Linker static RAM excludes those runtime allocations; measure heap/stack on your actual board.
IDs/sequences never wrap. Outbound messages are bounded to 1 KiB; device IDs use the shared v1 rules.

From the repository root:

```sh
pnpm exec tsx --test scripts/firmware.test.ts scripts/openhuli-client.test.ts
pio run --project-dir libraries/OpenHuli/examples/Telemetry --environment s2_mini_check
pio run --project-dir firmware/esp32-voice --environment s2_mini --environment s2_mini_check
```

The CI firmware job also compiles the actual command parser against ArduinoJson and tests the
client with fake ESP32/MQTT/queue boundaries. These checks cover SUBACK readiness, bounded input,
TLS configuration, duplicate/conflicting commands, storage failure, expiry, disconnect during an
effect, clock faults, and reconnect/reboot fences. They do not run a physical ESP32 or broker/TLS
handshake. The normal server tests validate emitted C++ messages against the TypeScript contracts.
