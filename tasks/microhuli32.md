# MicroHuli32 ESP32-C3 port

## Goal

Create `firmware/MicroHuli32` using an ESP32-C3 SuperMini and its expansion
board in place of the classic Arduino Nano. No issue supplied.

## Notes

- Branch `codex/microhuli32` starts at verified `origin/main` (`7ea54ae`).
  The previous branch has an unrelated local deployment commit, left intact.
- Preserve the existing Nano project. Port its current local controls and gait
  into a self-contained Arduino project; do not revive the legacy ESP32
  sketch's network services or copy the AVR-only EEPROM serial connection.
- Owner supplied the DUBEUYEW SuperMini/expansion listing and its prohibition
  on simultaneous USB and external power. Document separate power modes.
- Use ESP32Servo at 50 Hz / 14-bit resolution and explicit C3 I2C pins. The
  original mapping kept boot, USB and UART pins free; see the GPIO2 follow-up.
  Disable infrared LED feedback so it cannot drive
  the onboard boot LED. Bound USB transmit waits to 1 ms for local operation.
- Pin the existing Arduino-ESP32 2.0.17 toolchain. Use the official Arduino
  library archive URLs because PlatformIO's U8g2 registry lacks version 2.36.19.
  Include the generated `.ino.cpp` in the source filter and ignore that output.

## Verification

- PlatformIO `supermini` and `supermini_minimal` cross-builds both pass, with no
  compiler warnings. Full build: 303,786 bytes flash / 15,440 bytes static RAM;
  minimal build: 270,816 bytes flash / 14,428 bytes static RAM.
- `node --test scripts/microhuli.test.ts`: both test groups pass. This runs all
  seven existing Nano simulations plus the C3 local-control regressions with
  OLED present/absent and C3 pin/PWM/timeout/reported-attachment-failure checks.
- Reran the C3 host suite after making the servo stub reset timer resolution
  on attachment like the actual library: both scenarios pass.
- Architecture check, changed Markdown/TypeScript/YAML Prettier checks, local
  Markdown link targets, and complete staged diff whitespace checks pass.
- ESLint passes for the changed TypeScript using the repository's rules and
  existing local tooling. `pnpm exec eslint` was unavailable because this
  checkout has no completed dependency installation.
- Self-reviewed the complete diff and compared the port against the original
  Nano sketch. Application, database and browser suites were not run for this
  firmware-only change. Initial software validation did not flash hardware;
  see the requested hardware-test follow-up below.

## Remaining work / risks

Expansion-board power routing, actual PWM, infrared reception and loaded gait
need physical qualification.

Draft PR: https://github.com/oneway8x-com/OpenHuli/pull/57 (base `main`, head
`codex/microhuli32`).

## Front-left hardware test — 2026-11-14

- Owner requested testing the front-left servo and confirmed USB-only power
  with external power disconnected, following the expansion-board instruction.
- The attached C3 was running a Wi-Fi access-point test. Saved its complete
  4 MB flash in a private, ignored local backup before replacing the firmware.
- Rebuilt MicroHuli32 from `ec61fa8` and uploaded successfully with flash hash
  verification. The standalone USB command handler acknowledged STOP and HELP.
- Sent `TESTFL` once. The board reported `SERVO TEST start; GPIO3`, followed by
  `SERVO TEST complete; centered; pulses off`. This command requests eight
  90/85/95/90-degree cycles on the front-left output only.
- Sent a final STOP, received `STOPPED; servo pulses off`, and closed the port.
  Firmware execution is verified, but the owner subsequently reported no
  physical movement. The hardware test has not passed.
- Owner confirms signal on pin 3 and red on the expansion header's V rail.
  The supplied product image identifies VCC1/VCC2 separately from the blue 5V
  power block. Recommended the blue 5V output for the isolated USB-only test;
  actual supply voltage and ground continuity remain unmeasured.
- The first retest connection failed its STOP preflight, so it sent no movement
  command. After reconnecting and confirming STOP separately, `TESTFL` started
  and completed on GPIO3; owner again reported no movement. Final STOP succeeded.
- Built and temporarily uploaded a private diagnostic copy of the same sketch
  to sample GPIO3's input buffer without changing its PWM output routing.
  The first sample reported zero frequency/duty during startup; all 18 later
  samples reported 50 Hz, high times 1470–1525 microseconds, and combined
  high/low times 19998–19999 microseconds. The diagnostic completed and stopped.
- These measurements establish pulses at the chip pad, not signal delivery
  through the connector, voltage amplitude, motor supply or ground continuity.
  No firmware fault was established; physical movement still has not passed.
- Restored the normal MicroHuli32 build with flash hash verification, confirmed
  STOP and released the serial port. Diagnostic sources and the old-flash backup
  remain private and ignored; production firmware source was not changed.

## Front-left GPIO2 follow-up — 2026-11-14

- Owner requested moving the front-left servo signal from GPIO3 to GPIO2.
  Update the shared pin configuration, startup banner, wiring table and existing
  hardware-mapping regression. Other peripheral pins remain unchanged.
- GPIO2 is a strapping pin; retain detached startup and document checking reset
  behavior with the connected servo. Firmware cannot physically move the wire.
- The updated mapping regression fails against the old GPIO3 configuration at
  the actual attached-servo pin assertion, before changing the firmware.
- Both Nano/C3 host test groups and both C3 PlatformIO environments pass after
  the pin change. Architecture, changed Markdown formatting, local README links
  and complete diff whitespace checks pass. Self-reviewed the scoped diff.
- Uploaded the revised standalone firmware with flash hash verification. The
  board booted and acknowledged STOP and HELP; the serial port was released.
  No movement command was sent before the owner moves the signal wire to GPIO2.
- On the owner's subsequent request, sent `TESTFL` once. The board acknowledged
  `SERVO TEST start; GPIO2` and automatic completion; final STOP was acknowledged
  and the serial port released. The owner reported no physical movement.
- The GPIO2 change has not resolved the observed failure. Servo supply voltage,
  ground/connector continuity and a known-working replacement servo remain
  unchecked. The earlier GPIO3 pad measurements do not qualify GPIO2's waveform.
