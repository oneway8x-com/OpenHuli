# Environment setup

Follow [the README](../../README.md) for the tested local commands. Copy `.env.example` to `.env`
and use the local Compose connection; inspect the database target before migrating or seeding.

| Setting                                             | Current consumer / meaning                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                      | PostgreSQL connection used by app persistence and local seed; required for DB access.                                 |
| `DIRECT_DATABASE_URL`                               | Optional Prisma migration connection; falls back to `DATABASE_URL`.                                                   |
| `CORELY_DEV_TENANT_ID`                              | Development todo fallback and seed tenant, default `dev-tenant`; not authorization.                                   |
| `NEXT_PUBLIC_API_BASE_URL`                          | Browser API prefix; empty uses same-origin Next `/api` routes.                                                        |
| `JWT_SECRET`                                        | OTP auth helper signing key; current fallback is not suitable for public deployment.                                  |
| `RESEND_API_KEY`, `EMAIL_FROM`                      | Optional production email delivery; local OTP delivery logs to the server.                                            |
| `TEST_DATABASE_URL`                                 | Explicit test-only connection. Export before DB/E2E commands; local `openhuli_test` only.                             |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Local Compose-only settings; each defaults to `openhuli`. Keep `.env` connection strings consistent if changing them. |

Root Next development loads `.env` through the documented setup; Prisma tooling loads root `.env`
from its config and process environment takes precedence. Browser tests override both database
connections for the test process and its Next server. Never point them at a shared or remote database.

Object storage adapters remain available but are not required for todo development. When enabling
one, inspect `packages/storage` for its settings; do not provision cloud storage merely to run checks.
Production owner authentication remains in issue #3. The persistent host validates its `RUNTIME_*`
settings independently and does not use the Next development Tenant/JWT fallback. See the
[persistent runtime guide](PERSISTENT_RUNTIME.md) for settings, `.env` loading, MQTT TLS, lifecycle
checks, and trust boundaries. Real device voice and deployment remain separate work; this is not
a Vercel-only deployment.
