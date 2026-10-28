# Device console (#19)

## Goal

Implement [#19](https://github.com/oneway8x-com/OpenHuli/issues/19) on `19-device-console`: pairing,
credential lifecycle, measured telemetry, manual commands, grants and minimal integration settings.

## Notes

- Started from `d81c8e0` after #18 merged. #12 belongs to another active chat. Verified #19 is
  In progress in Project 3 before editing.
- Added `/devices`, using existing authenticated pairing, credential rotation/revocation and grant
  use cases. One-time tokens stay in page memory, outside query caches and browser storage.
- Added an authenticated runtime management endpoint and same-origin Next.js bridge. Runtime-owned
  telemetry freshness/epoch and 24-hour history back the readings/chart. Presence is separate from
  sensor freshness; unsupported, empty and unavailable states remain explicit.
- Manual ping/display calls use committed conversation turns and the shared registered executor,
  exact approvals and real command receipts. Stable owner/request identities deduplicate delivery.
  Lost HTTP receipts recover through a read-only lookup; refresh never dispatches. Status reads
  validate the selected target. Shutdown aborts and drains owned dispatch work.
- The HTTP feature stores only Tenant forecast settings and enabled flags in the existing integration
  table. Future dispatches and pending approvals resolve current registry policy. Notes destinations
  and credentials remain server-managed and cannot be read back. Connection probes only read forecast
  or authenticated notes health; they never create notes or open AI sessions.
- Connected the existing measured telemetry read tools to the shared conversation registry alongside
  device commands. Device grants still do not replace owner write consent.
- Added setup/behavior documentation. No schema migration or new external package version.

## Verification

- Frozen offline install and full `pnpm typecheck` passed; final browser-test and HTTP module
  type checks passed after the last small changes.
- `pnpm test`: 346 unit tests and three script tests passed.
- `pnpm test:int`: 95 PostgreSQL integration tests passed. Final four management cases also passed
  against the final Tenant-filtered repository.
- `pnpm test:e2e`: all 14 Chromium journeys passed, including four device journeys plus existing
  conversation, owner and todo regressions. Lost-receipt recovery, exact approval, denial, unknown
  outcomes, credential rotation/revocation, grants and read-only probes are exercised.
- `pnpm build`, Prisma validation, architecture and prompt guards passed.
- Lint passed with zero errors and 98 existing warnings; changed files introduced no warnings.
- Changed source/document formatting, local document links and diff whitespace checks passed.
  Kept the generated lockfile's existing format with only its three-line dependency addition.
- Inspected full-page desktop (1440px) and mobile (390px) screenshots; no horizontal overflow.
  Synthetic forecast bytes/device delivery, real owner auth, executor, PostgreSQL and separate SQLite
  notes HTTP API were used. No paid provider calls or remote data changes.

## Remaining work / risks

- Physical hardware, public TLS, broker delivery and live Gemini acceptance were not tested.
- Notes secrets/destination changes require server configuration and restart; compatible custom notes
  APIs need authenticated `GET /health`. Saved Tenant settings override environment defaults.
- An already-dispatched action may finish after disable/cancel; unknown results require checking the
  device before another action. Charts show up to 100 latest samples, not full-history aggregation.
- Opened [PR #38](https://github.com/oneway8x-com/OpenHuli/pull/38), targeting `main` from
  `19-device-console`. CI pending at handoff. No merge or deployment authorized.
- Stopped and removed the owned disposable PostgreSQL cluster and generated build cache.
