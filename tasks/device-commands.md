# Acknowledged device commands

## Goal

Implement #14 on `14-device-commands` from merged #10/#13 (`14b3787`). Project 3 status verified In progress before editing. #11 has its own active worktree and #12 depends on it.

## Decisions

- Commands own the transport boundary and durable dispatch lifecycle, reusing DeviceCommand and the shared authorized executor. No competing execution ledger or DDD layers.
- Command ID is the stable execution ID. Reserve once, claim dispatch once, publish non-retained without offline/reconnect replay, and require an authenticated matching device acknowledgement for success.
- Check owner-configured and advertised capabilities and fresh backend-epoch presence. Cancellation or missing ack after dispatch is unknown, never implied rollback.
- Publish/ack integration uses the existing authenticated MQTT runtime; manual owner callers and AI use the same registered tools/executor. UI remains #19.

## Verification

- Frozen offline installation passed. Added workspace links only; no external library version or schema/migration changes.
- Full typecheck and production build passed, including Next and E2E source types. Final command/contracts
  typechecks and runtime builds passed after exact-action binding, clock and diagnostic evidence checks.
- 282 Vitest tests plus 3 script tests passed. Reference receiver covers concurrent duplicates, identity
  conflicts, capacity, missing display, uncertain effects, expiry and backwards clocks before dispatch.
- All 81 PostgreSQL integration tests passed after committed migrations on a disposable local database.
  Includes 16 command cases: owner/device execution, pending-before-ack, exact target/action/arguments,
  first/late/duplicate/wrong/retained receipt handling, offline/unsupported/failure/expiry, timeout,
  cancellation, host shutdown and restart reconciliation with no publish/replay.
- All 6 real Mosquitto broker tests passed, including scoped command publication/result ingestion,
  spoofed receipt rejection, duplicate delivery causing one simulated physical effect, lost display
  acknowledgement remaining unknown, explicit offline rejection and no old command on reconnect.
- Prisma validation, architecture/prompt checks, full lint (0 errors, 98 existing warnings), changed-file
  formatting and diff checks passed. Changed feature code has no lint warnings.
- Built runtime with authenticated local MQTT and synthetic configured Gemini key reported readiness 200
  and exited cleanly on SIGTERM. No provider connection/request was made. Existing broker image used;
  no broker plugin change needed. No physical hardware, paid provider, deployment or remote migration.
- Self-review added exact execution/action argument binding, preserved original cancellation reason with
  late evidence, tracked settlement before closing database clients, and immediate pre-effect clock checks.
- A final full integration rerun exposed a pre-existing Prisma 7 commit-conflict retry gap in telemetry
  presence: the adapter can return DriverAdapterError with TransactionWriteConflict rather than P2034.
  A targeted regression failed before the fix and passed afterwards. The existing bounded transaction
  retry now recognizes that exact rolled-back database conflict; no network/command effect is retried.
  All 81 integration and six broker cases passed after the fix.
- One typed fake initially widened a string literal; narrowed it and reran typechecks. Timeouts in fixtures
  are explicit and happy-path receipts use a larger deadline than deliberate missing-ack tests.

## Remaining work / risks

- Implementation and required checks complete; commit/push and open PR against main. Keep #14 In progress until merge.
- Actual ESP32 firmware and display hardware remain #15/#16 and later hardware acceptance. The shared receiver
  is a tested simulator/reference algorithm, not a promise of exactly-once physical effects across power loss.
- Manual UI and interactive approval/resume remain #18/#19. Both owner and AI use the same executor; current AI
  command turns need explicit low-risk preauthorization, exact device grants and an enabled authenticated broker.
- No automatic retry/replay after disconnect, timeout, cancellation or restart. Unknown outcomes require operator
  investigation; late evidence is retained without reviving the outcome. Raw display text/receipt metadata is
  operational data; broader retention cleanup/spend policy and hosted TLS remain their existing tickets.
