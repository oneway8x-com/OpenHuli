# MVP evaluation report template

Copy this template per run. This blank template records no passing checks.

## Run identity

- Date/time and commit:
- Mode: deterministic / opt-in live simulator / physical hardware
- Provider/model and adapter version (no credentials):
- Firmware commit, board revision and microphone model:
- Verified wiring/power/display/speaker evidence, or unavailable:
- Redacted configuration: budgets, retention, sample interval, grants and consent policy:
- TLS/deployment and recovery evidence:
- Planned cases, attempts per case and happy-path denominator:
- Disposable test data and synthetic notes destination:

## Results

Add one row per attempt for E01–E32, including blocked or nonapplicable cases. Correlation IDs
link to reviewed evidence; they are not themselves proof of an HTTP or physical effect.

| Case / attempt | Mode | Pass / fail / blocked / N/A | Conversation / turn / execution / command IDs | Receipt or physical evidence | Failure or N/A reason |
| -------------- | ---- | --------------------------- | --------------------------------------------- | ---------------------------- | --------------------- |
| E01 / 1        |      | blocked                     |                                               |                              | Not run               |

- Actual deterministic commands, exit results and CI run/commit:
- Live happy-path passes / planned attempts and percentage:
- Safety/error gates passed / failed / blocked:
- Twenty consecutive hardware turns: individual outcomes and evidence:
- One-hour mixed run: start/end, readings/errors, voice turns, outage/recovery, resets:
- Independent maker reproduction and short redacted demo:

## Timings

Attach the offline `pnpm eval:timings` summary when using diagnostic exports. Its combined useful-output
metric cannot separate text and audio; add independent channel measurements where available.
Keep mode, tool class and text/audio measurements separate. Follow the percentile definition in
[the evaluation guide](RELEASE_EVALUATION.md). Include missing/failed counts, not zero placeholders.

| Group / phase and endpoints                | n   | Missing / failed | p50 ms      | p95 ms      | Aspirational target / observation |
| ------------------------------------------ | --- | ---------------- | ----------- | ----------- | --------------------------------- |
| Physical no-tool, commit → useful output   | 0   | Not measured     | unavailable | unavailable | 3000 ms                           |
| Physical fast read, commit → useful output | 0   | Not measured     | unavailable | unavailable | 5000 ms                           |

## Decision and cleanup

- Release gate: pending / failed / verified, with evidence for every required gate:
- Remaining blockers and issue links:
- Synthetic data cleanup and external notes cleanup result:
- Redaction review: no credentials, personal recordings or private configuration published:

Do not mark verified with missing hardware or live evidence. A mock pass or a completed socket
turn cannot replace matching provider/tool receipts and physical observations.
