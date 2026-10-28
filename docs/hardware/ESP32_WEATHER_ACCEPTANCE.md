# DHT11 / LCD1602 physical acceptance

Status: **Not run**. Issue #16 remains In progress. This template records evidence; it is not a wiring map.

## Confirmed setup

- Board/revision, MCU, detected flash/PSRAM and firmware commit: pending.
- DHT11 manufacturer/module, pull-up and logic voltage: pending.
- LCD: user reports LCD1602 with a 16-pin parallel header. Exact controller/datasheet and voltage: pending.
- Verified DHT, LCD RS/E/D4–D7, microphone, button and LED GPIO allocation: pending.
- LCD R/W ground, contrast/backlight supply, current limiting, USB current and common-ground checks: pending.
- Profile, CA/hostname, credential scopes, grants and tool policy (without secrets): pending.
- Normal/combined versus separate sensor-node configuration and NVS journal state: pending.

## Observed checks

| Check                                                                                                                 | Result  | Evidence |
| --------------------------------------------------------------------------------------------------------------------- | ------- | -------- |
| Compare timestamped DHT11 readings with a reference; verify approximately 60-second cadence                           | Not run |          |
| Disconnect/bad-checksum sensor reports errors and no freshly stamped last-good value                                  | Not run |          |
| Local measurements/error display continue with AI unavailable and then Wi-Fi disconnected                             | Not run |          |
| Verified TLS succeeds; wrong CA/hostname and revoked MQTT credential fail closed                                      | Not run |          |
| Disconnect emits newer Last Will; reconnect publishes newer online state without stale replay                         | Not run |          |
| Spoofed target/topic, retained/oversized/fragmented packets and expired commands cannot act                           | Not run |          |
| Duplicate command writes screen once; conflicting reuse cannot change text                                            | Not run |          |
| LCD displays approved real text before success receipt; test unplugged/miswired screen and document write-only limits | Not run |          |
| Power loss during reservation/write/receipt remains uncertain; no replay after reboot                                 | Not run |          |
| Clock rollback/drift disables commands; persistent journal failure prevents the effect                                | Not run |          |
| Spoken request combines the real sensor timestamp/value with a live forecast                                          | Not run |          |
| Spoken approved display command changes the connected LCD and returns correlated receipt                              | Not run |          |
| One-hour mixed voice/telemetry/display run has bounded queues and stable measured memory                              | Not run |          |
| Network outage/recovery, USB power and I2S/RMT timing interaction pass under radio load                               | Not run |          |
| Separate sensor-node flow works without microphone/provider credentials                                               | Not run |          |

Record current/minimum heap, PSRAM, voice/capture/weather stack headroom, queue peaks, reconnect counts,
command outcomes, per-phase timings and correlations throughout the run. Keep NVS erase/recovery and
unknown-outcome investigation explicit. Do not share credentials, private audio or unrelated personal data.
