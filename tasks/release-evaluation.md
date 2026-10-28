# Release evaluation and maker handoff

## Goal

Start [#22](https://github.com/oneway8x-com/OpenHuli/issues/22) with a reproducible evaluation
plan and report. Branch: `22-release-evaluation`, based on main at `2906eee`.

## Notes

- Project 3 status changed from Backlog to In progress and verified before editing.
- #15 firmware wiring is awaiting hardware details in another chat; #21 startup verification is
  active there. Preserve their work and document independent release preparation here.
- Add 32 explicit cases, honest mode separation, evidence-based success/latency calculations,
  hardware endurance gates, report template and links to existing maker/extension guides.
- This documentation prepares evaluation; it does not complete physical or live acceptance.

## Verification

- Prettier formatted and checked all four changed Markdown files.
- Local link validation: 43 relative links resolve; E01–E32 appear once in order.
- Complete documentation diff self-reviewed; `git diff --check` passed.
- No executable behavior changes; runtime suites were not rerun for this documentation change.
- Live/provider and physical evaluations were not run; no provider key or verified hardware is available.

## Remaining work / risks

Run and publish actual deterministic/live/hardware reports; verified wiring, 20 physical turns,
one-hour endurance, measured latency and independent maker reproduction remain pending.
