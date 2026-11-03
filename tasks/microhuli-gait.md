# MicroHuli gait direction and tuning

## Goal

Correct WALK moving backward and BACK moving forward, and make walking faster
with a larger swing. No issue supplied. Branch: `codex/microhuli-gait`, based on
verified `main` at `ba5b621`.

## Notes

- USB and IR commands share the same motion handler. Reverse phase progression
  for forward walking instead of backward walking; preserve turning/spin phases.
- Use a 1100 ms cycle and 35 degree amplitude. Reduce rear offsets from +/-40
  to +/-35 so straight walking fits the existing 20–160 degree output bounds.
- Use a 4 degree per 20 ms slew limit for gaits only; preserve the existing
  3 degree limit for poses, isolated tests and tricks.

## Verification

- New direction regression fails on the original firmware at the first forward
  rear-leg quarter-cycle assertion, matching the reported direction reversal.
- `sh firmware/MicroHuli/tests/run_host_tests.sh`: all seven runs pass, covering
  USB aliases and IR forward/backward keys, 70-degree actual simulated swings in
  both directions within 1100 ms, output bounds, 4-degree maximum gait increments,
  STOP, finite steps, poses and connected-mode motion isolation.
- `arduino-cli compile --fqbn arduino:avr:nano firmware/MicroHuli`: passes;
  22,550 bytes flash, 1,299 bytes static RAM.
- Connected Nano compile with `--library libraries/OpenHuliSerial` and
  `--build-property build.extra_flags=-DMICROHULI_CONNECTED=1`: passes;
  25,378 bytes flash, 1,563 bytes static RAM. Existing low-memory warning remains
  (485 bytes available for stack/runtime); physical stability is unqualified.
- Changed Markdown Prettier checks, local links and `git diff --check` pass.
  Complete diff self-reviewed. This changes firmware only; application runtime,
  database and browser suites do not exercise this sketch and were not run.

## Remaining work / risks

Physical direction, loaded speed, clearance and power stability need testing
on the assembled robot. No firmware upload is part of this change.

Draft PR: https://github.com/oneway8x-com/OpenHuli/pull/56 (base `main`, head
`codex/microhuli-gait`).
