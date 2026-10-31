# MicroHuli robot import

## Goal

Copy the supplied robot project into OpenHuli, rename it MicroHuli, and adapt it to the existing device transport. No issue supplied. Branch: `codex/microhuli-import`, based on verified `main` at `5ed2555`.

## Notes

- Keep the source checkout unchanged; copy firmware, diagnostics, host tests, photos and printable/CAD files into `firmware/MicroHuli`.
- Rename sketch, STL references, build flags, display/boot labels and BLE name. Remove local machine paths and imported upload claims. Preserve existing mechanical dimensions and local robot behavior.
- Optional `MICROHULI_CONNECTED=1` uses the existing OpenHuliSerial client at 19200 baud with ping and 32-character literal display, no sensors or motion commands. Default retains standalone USB commands. Credentials and authorization remain on the existing gateway/server.
- EEPROM bytes 0–15 belong to the library boot journal. No migration, cloud configuration or server capability changes.

## Verification

- `firmware/MicroHuli/tests/run_host_tests.sh`: five simulations pass, including local controls with/without OLED, connected handshake/ping/display with/without OLED, duplicate and motion isolation, unknown I2C timeout without background retries, and corrupt EEPROM fail-closed behavior.
- `pnpm exec tsx --test scripts/microhuli.test.ts`: passes; included in the root script-test glob.
- Arduino CLI Nano local build: passes, 22,474 bytes flash / 1,299 bytes static RAM.
- Arduino CLI connected Nano build with the real local OpenHuliSerial library: passes, 25,306 bytes flash / 1,563 bytes static RAM (485 bytes remain; compiler low-memory warning).
- Connected Nano build with OLED and IR disabled: passes, 10,982 bytes flash / 608 bytes static RAM.
- `pnpm typecheck`, `pnpm --filter @corely/data exec prisma validate`, `pnpm arch:check`, `pnpm build`: pass.
- `pnpm test`: passes, 39 test files / 380 Vitest tests, plus script tests. Initial overlapping package builds caused transient package-resolution/Arduino cache failures; isolated build paths and a sequential test rerun passed.
- Node 24.2.0 satisfies the declared >=22.19.0 engine; pnpm 10.26.0 matches the declared package manager.
- Changed Markdown/TypeScript formatted; targeted ESLint passes. Local Markdown links resolve; 3MF archive integrity and renamed metadata pass. No old project labels or machine-specific paths remain in copied text. Source checkout unchanged.
- Self-review: copied assets retain geometry; existing motion/IR behavior preserved; no network movement, new authority, fake sensor values or secret config introduced.

## Remaining work / risks

Physical Nano/OLED/IR, the connected build's 485-byte runtime memory margin and loaded gait require qualification; no hardware uploaded. Cloud motion is unsupported by the current protocol; ping-only liveness can become stale. Draft PR: https://github.com/oneway8x-com/OpenHuli/pull/54 (base `main`, head `codex/microhuli-import`).
