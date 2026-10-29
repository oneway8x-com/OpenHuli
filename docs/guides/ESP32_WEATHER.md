# ESP32 DHT11 and LCD1602 reference

For the imported standalone station with the existing outer-row pin map, Berlin weather pages
and OpenHuli library integration, use [Weather Station V1](../../firmware/weather-station/README.md).
The combined voice/weather reference below remains a separate firmware application.

Issue [#16](https://github.com/oneway8x-com/OpenHuli/issues/16) extends the
[microphone reference](ESP32_VOICE.md) with DHT11 sampling, verified MQTT TLS, ping receipts and an
optional LCD1602. **Physical acceptance is pending.** The user selected an LCD1602 with a 16-pin
parallel header; its exact manufacturer/controller, supply, signal thresholds, GPIO map and USB power
budget have not been verified. No ESP32 GPIO assignments are proposed here.

The reusable MQTT/protocol code now lives in the [OpenHuli Arduino/PlatformIO client](../../libraries/OpenHuli/README.md).
The reference keeps its DHT11/LCD/GPIO adapters and consumes the library from this checkout; keep
`libraries/OpenHuli` alongside `firmware` when building it.

## Configuration and hardware

Use the same ignored `firmware/esp32-voice/include/config.local.h`, copied from the updated example.
Defaults remain inert: hardware confirmation is false, weather/display are disabled, pins are `-1`,
and credentials/CA settings are empty. Configure only confirmed hardware; do not upload the CI link-check
image or treat a successful build as a wiring test.

| Setting                                                | Purpose                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `hardware_confirmed`                                   | Enable only after checking board, wiring, power and logic levels.                                                                     |
| `voice_enabled`                                        | True for combined voice/weather; false for a separate sensor node.                                                                    |
| `weather_enabled`, `dht_data`                          | Enable the DHT11 service and set its confirmed open-drain data GPIO.                                                                  |
| `device_id`                                            | Exact owner-issued device ID; no Tenant claim is accepted from the firmware.                                                          |
| `mqtt_host`, `mqtt_port`, `mqtt_root_ca`               | Broker DNS hostname, TLS port (default 8883) and trusted PEM CA. No plaintext or insecure fallback.                                   |
| `mqtt_username`, `mqtt_client_id`, `device_mqtt_token` | Copy the issued `mqttUsername`, `mqttClientId` and separate `purpose=mqtt` credential. Never substitute a voice/owner/provider token. |
| `display_enabled`, `display_confirmed`                 | Optional parallel, HD44780-compatible LCD1602; confirm controller and levels before enabling.                                         |
| `lcd_rs`, `lcd_enable`, `lcd_d4`–`lcd_d7`              | Six separately confirmed output GPIOs for 4-bit mode.                                                                                 |

GPIO validation rejects duplicates, microphone/button/LED conflicts, USB/flash/strapping pins and
invalid input/output assignments. Sensor-only mode leaves microphone/button/voice settings unused.
Disabled display GPIOs are not initialized. The LCD library object is constructed only after validation,
because its constructor itself drives pins.

For the confirmed **parallel** interface, the candidate adapter uses RS, E and D4–D7; R/W is tied to
GND and D0–D3 are unused. Check the actual LCD datasheet for header orientation, power, contrast and
backlight connections, current limiting and 3.3 V input compatibility. A 5 V LCD supply does not prove
its inputs accept ESP32 levels. Use appropriate level translation if required; no LCD output is connected
to an ESP32 input. Check the DHT11 module's pull-up voltage separately: the data line must remain
ESP32-safe. Verify common ground and total USB power without back-powering supplies.

## Pairing and backend

For combined voice/weather, pair using the existing `esp32-voice` profile with microphone, temperature,
humidity and ping capabilities. Add `display` with `maxTextLength: 32` only when the LCD is configured
and verified. The microphone-only profile cannot be reused for a sensor/display node. The current UI
supports weather-station pairing directly; the combined optional sensor capabilities use the existing
owner pairing API:

```json
{
  "name": "Combined weather reference",
  "profileId": "esp32-voice",
  "profileVersion": 1,
  "capabilities": [
    {
      "kind": "microphone",
      "format": {
        "encoding": "pcm_s16le",
        "sampleRateHz": 16000,
        "channels": 1,
        "chunkDurationMs": 20
      }
    },
    { "kind": "temperature" },
    { "kind": "humidity" },
    { "kind": "ping" },
    { "kind": "display", "maxTextLength": 32 }
  ]
}
```

Omit the display capability for an absent screen. For a **separate sensor node**, set
`voice_enabled=false`, use the `weather-station` profile and advertise temperature/humidity/ping plus
the optional verified display; no microphone or voice credential is required. Local sampling/display
continue without a live AI provider, Wi-Fi or broker. A voice node can query that sensor through the
backend's granted telemetry tools; it does not invent or privately relay room measurements.

Enable [MQTT telemetry](MQTT_TELEMETRY.md), [device commands](DEVICE_COMMANDS.md), their existing grants
and owner approvals, and the [TLS deployment](DOCKER_DEPLOYMENT.md). Keep the backend's telemetry interval
at 30 seconds (default) or 60 seconds for this approximately 60-second sampler, so its liveness window
covers the reporting cadence. For a spoken measured-reading-plus-forecast request, also enable the
[voice gateway](VOICE_GATEWAY.md), [live provider](LIVE_CONVERSATIONS.md) and [forecast tool](HTTP_TOOLS.md).
Provider configuration stays server-side.

## Sampling, local display and MQTT

The DHT11 service samples after a two-second startup delay and about every 60 seconds thereafter.
It uses the bundled ESP-IDF [RMT receiver](https://docs.espressif.com/projects/esp-idf/en/v4.4.7/esp32s2/api-reference/peripherals/rmt.html)
on channel 0, with hardware pulse timing, a bounded receive ring and checksum/range validation. The
20 ms start pulse yields the CPU; no long interrupt-disabled bit-banging section is used. A dedicated
lower-priority worker keeps sensor/MQTT/display waits outside the voice loop and the priority-3 I2S
capture task. Actual timing and heap under radio load still require a mixed hardware run.

A failed read publishes empty `readings` and explicit `read_failed` entries for both metrics. It never
reuses the last good values with a fresh timestamp. Before clock sync, a reading can update the local
screen but is not later stamped as a newly measured cloud reading. Samples are sent only while
connected; no offline backlog is uploaded or persisted. Samples keep their original timestamp.

With the optional LCD, each sample replaces the two rows with measured temperature/humidity or
`Sensor read error`, even if AI is unavailable. A display command writes up to 32 printable ASCII
characters, wrapping after column 16 and padding the remainder; the next sample replaces that text.
Unicode/control characters and longer text are explicitly unsupported. The pinned Arduino
[LiquidCrystal driver](https://github.com/arduino-libraries/LiquidCrystal/tree/1.0.7) uses a write-only
parallel interface. A success receipt means the full GPIO write sequence completed after local hardware
confirmation; it provides no electrical or pixel readback. Observing the real screen is a separate
acceptance requirement, including disconnected/miswired-display behavior.

The bundled [ESP-MQTT client](https://docs.espressif.com/projects/esp-idf/en/v4.4.7/esp32s2/api-reference/protocols/mqtt.html)
uses a separate task, CA/hostname verification, clean MQTT 3.1.1 sessions, QoS 0 publications and exact
owner-issued topics. No offline outbox/enqueue API is used. Each connection publishes a truthful
manifest and online presence, with a newer offline Last Will. Reconnect allocates a newer online/Will
sequence pair. Telemetry has its own sequence and refreshes backend liveness. Stale retained state
cannot establish a current backend session. Network retry backs off to 30 seconds; no queued commands
or effects are replayed after reconnect. SDK diagnostics are disabled in this reference.

## Command safety and bounded state

Only non-retained packets on this device's exact `/commands` topic are accepted. Fragment offsets,
total length, JSON shape, IDs, target, canonical UTC timestamps and action are checked. Input is bounded
to 4 KiB, with two queued packets and sixteen active command records. Full queues/caches reject work;
records remain until expiry. Missing LCD hardware returns `unsupported_capability`; ping needs no screen.

Clock sync establishes a monotonic UTC anchor. A backwards clock step or divergence over one second
latches MQTT command operation closed until restart; local sampling/display continue. Commands issued
in the future, before the fresh connection watermark, after expiry, or with a lifetime over 30 seconds
cannot execute. Time is checked again immediately before the effect and completion is timestamped
afterward. A write completing after its deadline remains unknown.

Before an effect, the service commits the greatest accepted expiry to the small NVS `openhuli_cmd`
journal. A persistence failure prevents the effect. On reboot/reconnect that persisted expiry also
sets the rejection watermark, so an old unexpired command cannot execute twice, including with a small
clock offset. New commands can be rejected until that previous expiry (at most a valid command lifetime)
has passed. Within a connection, exact duplicates return the original result without another write;
conflicting reuse is dropped. The journal cannot establish whether a crash between reservation and
completion changed a screen. The server must retain an uncertain outcome; there is no automatic retry.
Do not erase the journal to retry an uncertain action. NVS write endurance and real power-loss behavior
still need validation for the intended command rate.

## Build and acceptance

Use the microphone guide's pinned Python/PlatformIO setup, then:

```sh
pio run --project-dir firmware/esp32-voice --environment s2_mini --environment s2_mini_check
pnpm exec tsx --test scripts/firmware.test.ts
```

The normal build preserves disabled defaults. The **link-check** environment makes example settings
runtime reads so the linker must retain all optional adapters, without assigning pins or enabling
hardware. CI runs both: default constant settings alone could optimize optional code away. Only the
example header participates; no private configured image or credentials are published.

The firmware CI job also compiles and runs `test/command_json.cpp` against the actual ArduinoJson
parser; its build recipe is in `.github/workflows/ci.yml`. It rejects wrong targets/types, invalid
timestamps, embedded NULs and oversized input before command execution.

Native tests compile the actual portable C++ core, decode synthetic DHT pulses and pass emitted
telemetry/presence/results through the shared TypeScript schemas. They cover sensor errors, partial
MQTT packets, retained rejection, expiry, clock drift, duplicates/conflicts, bounded capacity, unsupported
display and persistence-before-effect/reboot behavior. These are synthetic tests, not a real sensor,
broker connection from an ESP32, display observation or concurrency measurement.

Complete [the hardware record](../hardware/ESP32_WEATHER_ACCEPTANCE.md), including a one-hour mixed
voice/sampling/display run and outage/recovery, before declaring #16 complete. No board was flashed
and no GPIO map or hardware result was validated during the general implementation.
