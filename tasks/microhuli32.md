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
- Use ESP32Servo at 50 Hz / 14-bit resolution and explicit C3 I2C pins. Keep
  boot, USB and UART pins free; disable infrared LED feedback so it cannot drive
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
  firmware-only change. No hardware was flashed or moved.

## Remaining work / risks

Expansion-board power routing, actual PWM, infrared reception and loaded gait
need physical qualification. No upload requested.
