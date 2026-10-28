# ESP32 microphone acceptance record

Status: **not run**. This is a record template for issue #15, not a validated wiring diagram.

## Confirmed hardware

- Board manufacturer/model/revision: pending.
- MCU/flash/detected PSRAM: pending.
- Microphone manufacturer/model/datasheet and slot/alignment: pending.
- Verified BCLK/WS/DIN, button and optional LED GPIOs: pending; no suggested numbers.
- Supply, microphone logic voltage, common ground and USB power observations: pending.
- Firmware commit, PlatformIO/toolchain versions, configuration fingerprint (without secrets): pending.
- TLS hostname/CA chain, clock sync and server/provider configuration (without secrets): pending.

## Bench and radio checks

Record actual amplitude/noise/clipping, sample rate, first-chunk time while speaking, queue peak,
current/minimum internal heap, PSRAM usage and capture stack headroom under Wi-Fi load. Compare
successive turns for growth; linker/static RAM figures do not satisfy this measurement.

| Check                                                                                   | Result  | Evidence |
| --------------------------------------------------------------------------------------- | ------- | -------- |
| Correct certificate/hostname connects; wrong CA and hostname fail closed                | Not run |          |
| Press/release states visible; chunks arrive before release                              | Not run |          |
| Silence, speech amplitude, correct L/R slot and sample conversion                       | Not run |          |
| Live spoken forecast reaches registered real forecast GET and truthful text response    | Not run |          |
| Twenty consecutive short hardware turns, with per-turn outcomes and heap/queue readings | Not run |          |
| Cancel while recording; cancel while waiting                                            | Not run |          |
| Wi-Fi loss/partial frame before commit triggers no external action                      | Not run |          |
| Reconnect while button held creates no resumed/automatic turn                           | Not run |          |
| Credential expiry/revocation blocks or terminates access                                | Not run |          |
| Congestion, read failure and 30-second limit abort without incomplete commit            | Not run |          |
| Credentials/provider keys absent from shared logs and evidence                          | Not run |          |

Attach sanitized logs with correlated server turn/execution IDs, useful timings, and measured resource
figures. Do not include tokens, Wi-Fi passwords, raw private audio or unrelated personal information.
If the S2 fails memory/audio requirements, record the failure and proposed board change; do not mark
this ticket complete using only simulator or host-native results. The longer mixed telemetry/display
run belongs to #16/#22 after its own hardware has been confirmed.
