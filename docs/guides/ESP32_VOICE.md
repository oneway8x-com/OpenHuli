# ESP32 microphone reference

Issue [#15](https://github.com/oneway8x-com/OpenHuli/issues/15) adds a configurable, microphone-only
ESP32-S2 reference. **Hardware acceptance is pending.** The `lolin_s2_mini` build selects a candidate
LOLIN S2 Mini target; it does not establish the actual board revision, microphone model, wiring or
working audio. No GPIO map is published until those details are confirmed. The optional [DHT11/LCD1602 extension](ESP32_WEATHER.md) adds MQTT telemetry and commands;
physical speaker support belongs to its separate validated profile.

## Hardware and configuration

The proposed profile has an ESP32-S2 Mini, a standard 3.3 V-compatible I2S microphone, an active-low
push-to-talk button and an optional external indicator LED. Check the microphone's own datasheet:
this adapter expects Philips I2S signed samples in 32-bit slots, not a PDM microphone. Confirm the
L/R selection and sample alignment before selecting `microphone_left_slot` and `sample_shift`.
The S2 has a standard I2S peripheral; see [Espressif's I2S documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s2/api-reference/peripherals/i2s.html)
and the [candidate board definition](https://docs.platformio.org/en/latest/boards/espressif32/lolin_s2_mini.html).

Copy `firmware/esp32-voice/include/config.example.h` to the ignored `config.local.h`. Defaults are
inert: `hardware_confirmed=false`, microphone/button GPIOs `-1`, and empty Wi-Fi/token/CA settings.
The default image prints an unconfigured message and does not initialize GPIOs, capture or Wi-Fi.
There is no developer credential or insecure-network fallback.

| Setting                          | Meaning                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `hardware_confirmed`             | Set true only after checking the exact board, microphone and wiring.                                                       |
| `mic_bclk`, `mic_ws`, `mic_data` | Confirmed clock, word-select and microphone data GPIOs; no defaults.                                                       |
| `button`                         | Confirmed GPIO with an active-low button to GND and internal pull-up.                                                      |
| `led`, `led_active_high`         | Optional confirmed external indicator and polarity; `-1` disables it.                                                      |
| `microphone_left_slot`           | Must agree with the microphone's wired L/R selection.                                                                      |
| `sample_shift`                   | Saturating signed 32-bit slot to PCM16 conversion; default 16, allowed 8–24. Validate audio amplitude/clipping physically. |
| `wifi_ssid`, `wifi_password`     | Local Wi-Fi credentials; SSID is bounded to 32 bytes.                                                                      |
| `voice_host`, `voice_port`       | Deployment DNS hostname and TLS port, without scheme/path/query. The path is fixed `/voice`.                               |
| `device_voice_token`             | Privately provisioned `purpose=voice` device credential; never an owner, probe or AI/provider key.                         |
| `root_ca`                        | Trusted PEM CA for the deployment's certificate chain. Hostname verification stays enabled.                                |
| `show_response_text`             | Default false. Opt in to printing private final answers to the local serial console.                                       |

Validation rejects duplicate pins and USB, flash/PSRAM, BOOT/strapping or invalid GPIOs. This reduces
configuration mistakes; it is not a substitute for the exact board schematic. Check microphone supply
voltage, GPIO signal levels, LED resistor and common ground before enabling the profile. Never infer a
5 V-compatible microphone/data input from an unrelated sensor-board example.

Private configuration and build outputs are ignored. They are not a secure element: a configured
binary/flash image contains Wi-Fi and device credentials and must be treated as private. Keep device
credentials scoped, expiring and revocable. Production flash protection and provisioning at scale
require a separate validated process; no provider key is needed on-device.

## Pairing and server setup

The additive `esp32-microphone` profile advertises only the microphone. Select **ESP32 microphone only**
in the owner's pairing form, or use the existing owner pairing API with:

```json
{
  "name": "Microphone reference",
  "profileId": "esp32-microphone",
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
    }
  ]
}
```

Copy only the one-time voice token into private firmware configuration. Pairing may also issue an
MQTT credential, but this firmware does not use it and must not advertise ping or display support.
The older `esp32-voice` and weather-station profiles retain their existing capabilities and checks.

Enable the [voice gateway](VOICE_GATEWAY.md), [live conversation provider](LIVE_CONVERSATIONS.md),
[forecast tool](HTTP_TOOLS.md), and current device grants on the server. The WSS hostname must match
its trusted certificate. The firmware waits for SNTP time before TLS, uses `beginSslWithCA`, and sends
`Authorization: Bearer <voice token>` without an Origin, query token or subprotocol. It never selects
plain WS, disables CA verification, or follows an HTTP redirect to a different endpoint.

## Build and checks

Requires Python 3.12+ and the repository's declared Node/pnpm versions. From the repository root:

```sh
python3 -m venv firmware/esp32-voice/.venv
. firmware/esp32-voice/.venv/bin/activate
python -m pip install platformio==6.2.0 esptool==4.11.0
pio run --project-dir firmware/esp32-voice
pnpm exec tsx --test scripts/firmware.test.ts
```

The PlatformIO project pins Espressif platform 7.1.3, Arduino ESP32 2.0.17 package
`4.20017.260907+sha.dcc1105b`, esptool package `2.41100.260830`, the S2 compiler, WebSockets 2.7.2 and
ArduinoJson 6.21.5. CI cross-compiles the inert reference; `pnpm test` also compiles/runs the portable C++
core and validates its actual control/audio output through the shared TypeScript v1 peer. A C++17
compiler (`c++`, or `CXX`) is required for those host tests. No device or live provider is used by CI.

The compile-default image's linker RAM/flash figures are recorded in the task diary; these are **not**
measurements of TLS/capture heap headroom under Wi-Fi load. Application audio/control buffers are
fixed-size and not explicitly allocated in PSRAM. The board preset may initialize available PSRAM;
record actual detected PSRAM and runtime heap before deciding whether this board is adequate.

Only after private configuration and hardware are confirmed, use PlatformIO's upload command with
the explicitly selected connected serial port, then monitor at 115200 baud. No upload was performed
as part of the initial reference implementation.

## Interaction and failure behavior

- Hold the button to capture; release to finish the last bounded read, drain audio and send exactly
  one commit with the final sequence number. Audio is forwarded during recording, not uploaded as a file.
- While waiting for an answer, hold the button for one second to cancel. A `c`/`C` serial character
  cancels recording/draining/waiting work. A held recording is allowed up to 30 seconds; exceeding it
  cancels rather than silently committing an incomplete request.
- LED: ready off, recording solid, draining/waiting blinking, disconnected/negotiating a slow pulse,
  protocol/capture errors fast blink for three seconds. Serial state messages work without an LED.
- The profile requests text only. It does not negotiate speaker output or send playback receipts.
  Final answers are received and validated; serial answer printing requires `show_response_text=true`.
- A dedicated capture task drains I2S continuously, forwards only the active recording, converts to
  little-endian PCM16 mono 16 kHz, and zero-pads a short final chunk. It never writes raw audio to flash.
- Six fixed queued chunks bound backlog to about 120 ms. A read failure (including a short non-final read), queue overflow, socket send
  failure or phase deadline aborts/disconnects before an incomplete turn can commit. Network writes
  can block up to transport deadlines; capture still runs, and congestion cancels instead of growing queues.
- Every item carries a generation fence. Cancel/disconnect clears pending audio; old in-flight reads
  cannot enter a later turn. Reconnection negotiates a fresh session, with no audio resume/auto-commit.
- Reconnect backoff grows to 30 seconds with jitter. Sessions reconnect after 64 turns or a bounded
  incoming-ID history. Button debounce and timers tolerate `millis()` rollover; holding at boot or
  reconnect does not start recording automatically.
- Controls are reassembled into one fixed 15 KiB buffer, matching the transport's stricter bound.
  Wrong version/format/order, binary speaker output, repeated control IDs and oversized/incomplete
  fragmentation cannot be treated as a completed turn. The library owns RFC 6455 framing and masking.

Cancellation after commit cannot undo an already accepted external write. The backend ledger remains
authoritative for approval, success and unknown outcomes; do not replay a previous turn on reconnect.

Every ten seconds, serial diagnostics report state, current/minimum internal heap, capture task stack
headroom, maximum observed queue occupancy and sent chunk count. They contain no credential or raw
samples. With answer logging enabled, local serial output additionally contains private answer text.

## Physical acceptance remains required

Use [the acceptance record](../hardware/ESP32_VOICE_ACCEPTANCE.md) before claiming #15 complete.
It must record exact board/revision, microphone/datasheet, verified pin map and power, detected PSRAM,
firmware hash/configuration, live server certificate checks and real sample/audio measurements.
Then run twenty consecutive spoken turns, including a live forecast request, with timestamps and
queue/heap/stack observations. Test release, cancel, Wi-Fi loss before commit, server revocation,
invalid certificate/hostname, silence/clipping and reconnect while the button is held.

A successful native test or cross-build does not establish audio quality, live cloud behavior, twenty
physical turns, or stable memory under radio load. If measured headroom/audio is inadequate, document
the evidence before choosing an alternative board. Do not invent a fallback success or GPIO map.
