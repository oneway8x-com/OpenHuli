# MVP-01: Reproducible OpenHuli foundation

## Goal

Implement [issue #2](https://github.com/oneway8x-com/OpenHuli/issues/2): accurate architecture/MVP
scope, working development and test commands, app test discovery, and CI for the current Next.js app.
Branch: `02-foundation`.

## Notes

- Owner selected MIT; aligned all 19 package manifests and preserved the original Corely attribution.
- Retained Next.js, PostgreSQL/Prisma, explicit feature use cases, and existing package scopes.
  The persistent WSS/MQTT runtime remains issue #5; authenticated owner access remains issue #3.
- Replaced the missing integration config and removed obsolete API/Workspace E2E setup. Unit
  discovery now selects explicit configs, including the app, without accidentally collecting DB tests.
- Replaced four placeholder auth assertions with seven tests of real auth handlers and mocked
  persistence. These do not establish authenticated isolation of the current todo routes.
- Integration and browser tests require an explicit loopback `openhuli_test` connection, override
  migration/runtime URLs consistently, and clean only synthetic test-owned rows.
- Browser journeys use the app's actual development script, a fresh server on port 3100, one worker,
  no retries, and assertions that wait for cold route compilation. Detail URLs must match UUIDs,
  not `/todos/new`. Run production builds and development browser tests sequentially: Next shares `.next`.
- Startup smoke exposed that the first root script did not pass `.env` to the API. The app's
  development command now loads the root file directly before launching Next.
- Added CI, minimal ESLint configuration, safe local seeding, prompt-check regression coverage,
  architecture/setup/security/MVP docs, and OpenHuli display branding. Removed tracked generated
  browser reports and ignored future artifacts. No unrelated runtime redesign or dependency upgrade.

- Applied the updated handoff workflow: renamed the branch to `02-foundation` and moved #2 to
  the existing In progress project status before publication.

## Verification

Local environment: Node 24.2.0, pnpm 10.26.0, PostgreSQL 17 in a fresh task-owned Docker instance.

- Frozen installation and Prisma generation passed; the updated lockfile also passed frozen/offline installation.
- Applied the existing migration to fresh development and test databases. Reapplying it reported no
  pending migrations; development seeding succeeded twice without duplicating the tenant.
- `pnpm typecheck`: passed, including package builds, application, and E2E configuration/fixtures.
- `pnpm test`: 61 package/app tests plus three script regression tests passed.
- `pnpm test:int`: six PostgreSQL-backed todo/tenant-isolation tests passed.
- `pnpm prisma:validate`, `pnpm arch:check`, and `pnpm prompt:check`: passed.
- `pnpm lint`: zero errors; 101 warnings remain in existing scaffold code.
- `pnpm build`: production build passed after running separately from development E2E.
- `pnpm test:e2e`: three actual browser/API/database journeys passed, including the final rerun using the app development script.
- Inspected generated desktop and 390px mobile screenshots: branding and task details render correctly.
  Evidence is under the ignored `apps/e2e/test-results/` create/persistence case directory.
- Documented `pnpm dev` smoke with a temporary copy of `.env.example`: both `/todos` and the
  PostgreSQL-backed `/api/todos` returned 200. Removed the temporary file and stopped the server.
- Test fixture cleanup left zero tenants and zero todos in `openhuli_test`.
- CI YAML parsed and required steps were checked; 25 documentation links and all package license
  declarations were verified. Changed-file formatting and whitespace checks passed.

## Remaining work / risks

- PR publication is in progress; GitHub CI results have not yet been observed. CI selects Node
  22.19.0; the local checks used the compatible newer version above.
- Do not expose the scaffold publicly before issue #3. Header-based development Tenant context and
  JWT/OTP hardening remain known follow-up work, not guarantees provided by these passing tests.
- Temporary development servers, copied `.env`, and task-owned Docker database resources were cleaned up.
