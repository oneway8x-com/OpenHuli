# Docker deployment and recovery

## Goal

Implement [#21](https://github.com/oneway8x-com/OpenHuli/issues/21) on `21-docker-deployment`, based on current main after #40/#41. Startup follow-up uses `21-deployment-startup` after #42 was merged. Package the complete local/single-host stack and reproducible TLS/recovery checks.

## Notes

- Project status moved to In progress before edits. No open PR owns this issue; dependency implementations are merged and current main CI passes.
- Keep existing developer Compose intact. New deployment profile uses production-mode applications, private database/bridge, authenticated native MQTT TLS and an HTTPS/WSS proxy.
- Operator-provided certificates support public PKI; a disposable local CA is for local/CI acceptance only. Never disable certificate/hostname verification.
- Docker daemon did not respond to a bounded availability check. Do not restart or prune the user's Docker installation.

## Verification

- `pnpm typecheck`, `pnpm test` (373 unit tests plus script tests), Prisma validation, architecture check, lint (98 existing warnings), and production build passed.
- Eight targeted setup/configuration/production-startup/secret-redaction/SUBACK tests passed: independent secrets and certificate SAN trust/mismatch, rendered private-surface checks, and remote-Docker-context refusal. Deployment scripts also passed a dedicated TypeScript check, ESLint and shell/JavaScript syntax checks.
- Offline Compose rendering passed. PR #42 normal CI passed, but its deployment job failed while app/runtime were restarting. Redacted diagnostics identify a production-only Next configuration import failure; the same failure was reproduced with the plain-Node SWC loader. A narrow public identity-config export fixes that reproduction while preserving startup auth validation. A native production Next process now starts successfully and serves login HTTP 200 without tsx hooks. The follow-up container run starts all five services healthy and passes HTTPS/WSS trust/authentication checks. Its next failure exposed mosquitto_sub returning exit zero for denied SUBACKs; health and smoke now inspect acknowledgement reason codes, with regression coverage. The local Docker daemon remains unresponsive; no cloud deployment, hardware connectivity or paid provider trace has been run.

## Remaining work / risks

Draft PR: https://github.com/oneway8x-com/OpenHuli/pull/42 (`21-docker-deployment` → `main`). Container acceptance requires a responsive Docker daemon/CI; cloud/hardware acceptance additionally needs an explicitly selected host, DNS/certificates and device/provider setup.
