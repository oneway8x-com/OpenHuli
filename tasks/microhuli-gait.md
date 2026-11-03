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

## All-servo stability follow-up

- Owner reports different rear/front mounting and confirms the existing isolated
  leg checks are correct. Preserve direction signs; no measured mounting angles,
  foot trajectories or contact timings were supplied.
- Audited all four outputs in all six steady gait modes using the actual sketch
  with simulated time and servos. Straight WALK/BACK fits the output bounds.
  The 1.2 multiplier for turns/spins requests 42-degree amplitude; the rear legs
  clip for 205 of 1100 ms, and the 4-degree limiter leaves about 5.4 degrees of
  error even at output updates (up to about 9.2 degrees between updates).
- Limit full turn/spin swings to the normal 35-degree amplitude. Keep the
  0.4 inside-turn multiplier. Output bounds, pose limits, direction signs and
  straight-walk settings remain as previously implemented.
- A new all-mode regression fails before the fix at an output-update tracking
  assertion; after the fix all seven host runs pass. The independent simulation
  audit reports zero clipped samples in all modes, and no target lag at output
  updates. Maximum 20 ms changes stay below 4 degrees.
- Added per-leg command ranges, isolated check sequences and mounting/tuning
  guidance. Research uses Iida/Pfeifer's four-servo experiments, Xu et al.'s gait
  analysis and Arduino's Servo API; none proves this assembly is stable. Updated
  the passive-shoe guide's stale firmware timing reference.
- Standalone and connected Nano builds pass: respectively 22,526/25,384 bytes
  flash and unchanged 1,299/1,563 bytes static RAM. The connected build retains
  the existing low-memory warning. Changed Markdown formatting/local links and
  diff checks pass; complete follow-up diff self-reviewed. Application code is
  unchanged, so application/database/browser suites were not run.
- Update the same draft PR #56. Physical stability and loaded step distance
  remain unverified; no hardware was moved or firmware uploaded during this
  follow-up.

## Requested firmware upload — 2026-11-03

- Owner explicitly requested uploading the latest firmware. Built the standalone
  Nano sketch from `58ce416` and uploaded with Arduino CLI readback verification
  to the connected Nano; upload and verification succeeded.
- Reran all seven host tests successfully before upload. Build uses 22,526 bytes
  flash and 1,299 bytes static RAM.
- At 115200 baud, observed `MICROHULI_NANO ready` with idle status, a successful
  `HELP` response, and `STOPPED; servo pulses off` after `STOP`. Closed the serial
  monitor so the port is available to the owner.
- No walking, pose or isolated-servo test was triggered. Loaded balance,
  direction and clearance remain physical checks. The previous source remains
  available in Git for rebuilding if a firmware rollback is needed.
