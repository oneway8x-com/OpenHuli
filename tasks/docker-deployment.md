# Docker deployment and recovery

## Goal

Implement [#21](https://github.com/oneway8x-com/OpenHuli/issues/21) on `21-docker-deployment`, based on current main after #40/#41. Startup follow-up uses `21-deployment-startup` after #42 was merged. Package the complete local/single-host stack and reproducible TLS/recovery checks.

## Notes

- Project status moved to In progress before edits. At initial selection no open PR claimed this issue, dependencies were merged, and verified base `9a6cc3c` had passing CI.
- Keep existing developer Compose intact. New deployment profile uses production-mode applications, private database/bridge, authenticated native MQTT TLS and an HTTPS/WSS proxy.
- Operator-provided certificates support public PKI; a disposable local CA is for local/CI acceptance only. Never disable certificate/hostname verification.
- Docker daemon did not respond to a bounded availability check. Do not restart or prune the user's Docker installation.

## Verification

- `pnpm typecheck`, `pnpm test` (373 unit tests plus script tests), Prisma validation, architecture check, lint (98 existing warnings), and production build passed.
- Eight targeted setup/configuration/production-startup/secret-redaction/SUBACK tests passed: independent secrets and certificate SAN trust/mismatch, rendered private-surface checks, and remote-Docker-context refusal. Deployment scripts also passed a dedicated TypeScript check, ESLint and shell/JavaScript syntax checks.
- Offline Compose rendering passed. PR #42 normal CI passed, but its deployment job exposed a production-only Next configuration import failure. The identity config now resolves through a public package export; plain-Node production startup and signing-secret validation have regression coverage.
- The next container run exposed `mosquitto_sub` returning exit zero for denied SUBACKs. Broker health and smoke now require the expected acknowledgement reason codes, with allowed/denied/missing/error regression coverage.
- [CI deployment job](https://github.com/oneway8x-com/OpenHuli/actions/runs/40705755362) passed at `b0a35ae`: complete container startup, verified HTTPS/WSS authentication boundary, MQTT TLS/auth/ACL rejection, unavailable-broker readiness, restart, backup, isolated restore and preserved unknown-write identity. The normal CI job also passed, including migration, integration, broker and browser checks.
- Run local validate PR: false (no aggregate `validate:pr` script exists; the individual required checks above ran). Local Docker remains unresponsive; no cloud deployment, physical-device connectivity or paid provider trace has been run.

## Remaining work / risks

PR #42 was merged. Active follow-up: https://github.com/oneway8x-com/OpenHuli/pull/43 (`21-deployment-startup` → `main`). Container smoke passed in CI; cloud/hardware acceptance needs an explicitly selected host, DNS/certificates and device/provider setup.
