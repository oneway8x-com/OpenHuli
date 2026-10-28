# OpenHuli local serial protocol v1

This is the small physical link between one Uno/Nano and one gateway. It does not replace the
cloud v1 protocol or establish Tenant authority. USB and ESP-01 use identical frames. CRC detects
corruption; the cable/UART and private gateway configuration are trusted physical boundaries.

## Framing and bounds

All integers are little-endian. A frame is `4f 48 01 KIND LENGTH PAYLOAD CRC16`: two magic bytes,
version 1, one kind byte, one payload-length byte (0–80), payload, then CRC16-CCITT-FALSE
(polynomial `0x1021`, initial `0xffff`, no final xor) over version through payload. Maximum total
size is 87 bytes. Example empty probe: `4f480101009dc8`.

Decode incrementally into fixed storage; do not assume one USB read or UART buffer contains a
whole frame. Reject bad versions/kinds/lengths/CRC without dispatch. UART boot chatter is not a
handshake. No dynamic strings, JSON, credentials, Tenant IDs or cloud command IDs occur on this link.

`S` below is a 24-byte session: durable node boot generation `u32`, node challenge generation `u32`,
and a 16-byte gateway nonce. Zero boot/challenge/nonce is invalid. All started sessions have a fresh
challenge; commands never migrate between them.

| Kind                        | Direction      | Payload                                                                                                                                    |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Probe                     | gateway → node | empty; invalidates the old node session and increments its challenge                                                                       |
| 2 Challenge                 | node → gateway | boot `u32`, challenge `u32`, challenge tick `u32`, sensor flags `u8`, display limit `u8`                                                   |
| 3 Start                     | gateway → node | S, echoed challenge tick `u32`                                                                                                             |
| 4 Ready                     | node → gateway | S, current node tick `u32`, sensor flags `u8`, display limit `u8`                                                                          |
| 5 Heartbeat                 | gateway → node | S, increasing heartbeat sequence `u32`                                                                                                     |
| 5 Heartbeat acknowledgement | node → gateway | S, echoed heartbeat sequence `u32`, node tick `u32`                                                                                        |
| 6 Sample                    | node → gateway | S, sample sequence `u32`, sample tick `u32`, temperature state `u8` and signed centi-°C `i16`, humidity state `u8` and centi-percent `i16` |
| 7 Command                   | gateway → node | S, command sequence `u32`, node deadline tick `u32`, action `u8`, text length `u8`, text bytes                                             |
| 8 Result                    | node → gateway | S, command sequence `u32`, completion tick `u32`, status `u8`                                                                              |

Sensor flags: bit 0 temperature, bit 1 humidity; other bits invalid. States: 0 omitted, 1 measured,
2 read failure, 3 unavailable. An unavailable value is not a measured zero. Valid measured ranges
are −4000…12500 centi-°C and 0…10000 centi-percent. Gateway capabilities must exactly match node
flags/display limit and must remain a subset of the owner-paired manifest.

Actions: 0 ping (empty text), 1 display (1–32 printable ASCII bytes). Display limit 0 means absent.
Results: 0 succeeded, 1 failed, 2 expired, 3 unsupported, 4 unknown. Completion is a final physical
callback result, never a serial write acknowledgement. A callback must return `unknown` if it
cannot confirm an effect. The next supported command starts only after the prior command settles.

## Session, time and replay rules

- Node boot generation is allocated durably before enabling the link. The AVR helper reserves
  16 EEPROM bytes in two CRC-protected committed slots. A failed readback, corrupt/uninitialized
  partial journal or exhaustion disables operation. Never silently erase it. EEPROM wear and
  physical supply stability require hardware qualification.
- Each probe disarms the node and increments a RAM challenge generation. Start must echo the
  current challenge within 1000 ms. A different/old Start cannot reset a live command cache.
- Gateway nonce is cryptographically generated (Node crypto / ESP8266 radio random source).
  Gates accept Ready only during their current probe and require a complete handshake in <1000 ms.
- Gateway sends heartbeats every second. Duplicate/old requests do not refresh the node lease;
  only a fresh matching acknowledgement refreshes the gateway. A 3-second gap or one-hour session
  lifetime invalidates the session. A new handshake resets counters; counters never wrap.
- Node uses wrapping `millis()` arithmetic with deadlines at most 15 s ahead. Gateway anchors the
  Ready tick to receipt UTC and monotonic time, including measured handshake time plus 10 ms
  uncertainty. It subtracts that uncertainty when mapping cloud expiry to node deadline. Sending,
  buffering or receiving a frame never restarts a command's TTL. Cloud-clock drift over 1 s closes
  the link. No valid UTC means no cloud dispatch.
- Samples map through the session anchor using the conservative earliest sample time, not a new
  receive timestamp. Gateways reject future, reordered or ≥60-second-old samples. Node publication
  is immediate while connected; no offline backlog exists.
- Node reserves exact command bytes and sequence before the synchronous callback. Equal bytes and
  sequence return the cached result. Conflicting or older sequences never execute. A result after
  the deadline is unknown. Reboot/challenge/session changes cannot replay the previous command.
- Gateways retain cloud correlation and persist greatest dispatch expiry before forwarding an
  effect. After restart, commands predating current connection time or persisted expiry cannot
  dispatch. The ESP-01 also rejects non-increasing issuance times, so its single cached cloud
  command does not permit older commands to re-execute. This is conservative: closely timed or
  out-of-order commands can be rejected instead of queued.
- Local timeout, disconnect, reset or lost acknowledgement after possible dispatch is unknown.
  No gateway republishes uncertain writes. Late results do not revive old sessions. Cloud
  `completedAt` is the gateway's final-receipt confirmation time; the node completion tick must
  also fall within the active session's time bounds.

## Presence policy

A gateway is online only after a live AVR handshake and MQTT subscription. Healthy local heartbeat
receipts allow online presence refresh every 30 s, even for a sensorless ping node. Within each fresh
cloud boot ID, online presence sequences increase; offline/Last Will uses terminal `UINT32_MAX`.
After terminal offline, start a new cloud boot ID and a new physical session. This is valid v1
ordering and ensures the Will remains newer than every heartbeat. Existing direct ESP32 clients
keep their online/Will sequence-pair policy.

The USB bridge deliberately stops on loss instead of reconnecting a stale process. An explicit
restart reads the durable fence and starts a new cloud/local session. ESP-01 reconnects with fresh
boot IDs and nonces. Switching routes is manual; never run both with the same paired MQTT identity.

## Evidence

Native tests exercise the actual C++ node and gateway, EEPROM interruption, duplicates, framing
and state bounds. TypeScript tests exchange bytes with that same C++ node. The production USB
adapter is tested through a real OS PTY and verified local MQTT TLS fixture; it is not a physical
Uno, an ESP-01 radio test, or Mosquitto/Cloud SQL qualification.
