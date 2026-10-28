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

Draft PR: [#44](https://github.com/oneway8x-com/OpenHuli/pull/44). Issue remains In progress.

## Offline timing summary follow-up

Branch `22-evaluation-timings` starts from main at `6a09b6e` after PR #44 merged.
Project 3 #22 remained In progress; the existing option was inspected and reapplied before edits.

Add an offline CLI consuming actual diagnostic response envelopes. It computes nearest-rank
p50/p95 from endpoint differences, counts missing/failed/active evidence, rejects duplicate
conversation exports and invalid elapsed values, and flags endpoint collection caps. Only aggregate
output is emitted, with no network calls, credentials, IDs or payloads. Mode/group labels are declared,
not verified. Combined useful output cannot establish per-channel or acoustic latency; tool windows
include human approval waits. No happy-path success or release verdict is inferred.

Verification:

- All 17 script tests passed, including six new timing-summary tests and CLI subprocess coverage.
- Focused strict TypeScript compilation passed for the CLI and its tests.
- Changed-source ESLint, architecture check, Prettier and whitespace checks passed.
- Complete diff self-reviewed against runtime journal writes and diagnostic repository limits.
- This standalone offline script changes no application behavior, schema or environment variables;
  application build, database and browser suites were not rerun.
- Hardware/live acceptance remains pending; test fixtures are synthetic timing evidence only.

Follow-up PR: [#46](https://github.com/oneway8x-com/OpenHuli/pull/46). #22 remains In progress.
