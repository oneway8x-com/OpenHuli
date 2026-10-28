# MQTT telemetry and device context

## Goal

Implement [#13](https://github.com/oneway8x-com/OpenHuli/issues/13): authenticated MQTT telemetry, presence/freshness, persisted history, retention, and grounded read tools.

## Notes

- Branch `13-mqtt-telemetry`, based on main after #5/#6/#7/#8/#9. Project status verified In progress before edits.
- #10 and #11 already have active implementation branches; #12 depends on them. This is the next independent ready issue.
- Keep authentication and exact-topic authorization in existing devices use cases. Keep broker/runtime transports thin, persistence in feature repositories, and tools behind the registered executor.
- Added additive sensor-error/presence migration and seven-day startup/hourly tenant-scoped retention. Latest reads hide expired data before cleanup. Bounded tool outputs distinguish measured sensor context from forecasts.
- Self-review caught the Will/queued-telemetry race: explicit offline persists until a newer online presence or boot, so delayed samples cannot resurrect a disconnected device. Regression coverage verifies this.
- Reuse existing telemetry rows. Separate presence from measurement freshness; retained online state cannot prove liveness after backend restart.

## Verification

- `pnpm install --offline --frozen-lockfile`: passed; no new JavaScript library introduced.
- `pnpm typecheck`, `pnpm test`: passed (243 unit tests plus script checks).
- `pnpm --filter @corely/data exec prisma validate`, `pnpm arch:check`: passed.
- `pnpm lint`: passed with 98 existing scaffold warnings, none in changed files. An initial parallel lint run raced Vitest temporary files; sequential rerun passed.
- `pnpm build`: passed for shared packages, runtime, and Next app.
- `pnpm test:int`: 63 tests passed against a disposable local PostgreSQL database, including authorized registered reads, Tenant isolation, concurrency/deduplication, sensor errors, freshness, retention, and restart persistence.
- `pnpm test:migrations`: fresh and seeded upgrades passed; existing telemetry receives the compatible empty sensor-error default.
- Built the pinned Mosquitto image with strict C compiler warnings. `pnpm test:broker`: five real-broker tests passed for scoped credentials/client IDs, cross-device publish/read denial, wildcard denial, private bridge protection, spoofed metadata, invalid humidity, size rejection, retained-online restart, Last Will, and immediate credential revocation.
- Built telemetry modules imported successfully and performed a database query through production composition.
- Changed-file Prettier check and `git diff --check`: passed. Complete diff self-reviewed.

## Remaining work / risks

- MQTT is opt-in. Development Compose binds plaintext MQTT to loopback; production TLS/private networking and deployment remain operator work.
- Presence uses the authenticated private WRITE callback because Mosquitto does not emit MESSAGE events for Last Will; ordinary telemetry/manifest uses broker-attested MQTT metadata. The native bridge is synchronous and intended for the single-owner MVP.
- Synthetic MQTT clients and real PostgreSQL/Mosquitto were verified. Physical firmware and the separate network simulator/provider journey were not exercised.
- Registered read tools are exported for conversation composition; current provider work remains separate (#10).
- PR: [#33](https://github.com/oneway8x-com/OpenHuli/pull/33), branch `13-mqtt-telemetry` into `main`. Scoped implementation committed and pushed; GitHub CI pending at handoff. No merge or deployment requested.
