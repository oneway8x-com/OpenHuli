# Environment setup

Follow [the README](../../README.md). Copy `.env.example` to `.env`, set `OWNER_EMAIL`, and inspect
the local database target before migration or `pnpm owner:bootstrap` (`pnpm db:seed` is an alias).
Bootstrap is an operator CLI; it creates or reuses the Home Tenant, user, and OWNER membership.
Development bootstrap accepts only loopback `openhuli` or `openhuli_test` databases.

| Setting                                             | Meaning                                                                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                      | PostgreSQL application connection.                                                                                                            |
| `DIRECT_DATABASE_URL`                               | Optional migration connection; falls back to `DATABASE_URL`.                                                                                  |
| `OWNER_EMAIL`                                       | Required single-owner email; normalized to lowercase. No signup endpoint.                                                                     |
| `APP_URL`                                           | Exact browser origin without a path; development defaults to `http://localhost:3000`. Production requires HTTPS except loopback.              |
| `JWT_SECRET`                                        | At least 32 characters; required outside explicit development. Production rejects known development secrets. Generate a private random value. |
| `RESEND_API_KEY`, `EMAIL_FROM`                      | Required production OTP delivery configuration; sender must be a valid email address. Development logs OTP codes locally.                     |
| `NEXT_PUBLIC_API_BASE_URL`                          | Keep empty for same-origin Next `/api` routes and cookies.                                                                                    |
| `TEST_DATABASE_URL`                                 | Explicit loopback `openhuli_test` connection used by DB/E2E commands.                                                                         |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Local Compose settings, default `openhuli`; match the connection strings.                                                                     |

Next development and production start load root `.env`. Prisma tooling loads it through its config;
process environment takes precedence. Browser tests override database and auth settings with synthetic
values. Never point tests at a shared or remote database. Run `NODE_ENV=production pnpm owner:bootstrap`
only after deliberately configuring the deployment database and all required production settings.
Changing the configured owner requires explicit operator bootstrap and invalidates the former owner's
access; it does not delete that user's records. Changing the signing secret invalidates access tokens
and pending OTP codes. Existing refresh sessions can obtain new access tokens; revoke sessions in the
database when rotating a compromised signing secret.

Builds can run without production credentials; runtime startup validates configuration. A green build
is not a deployment check. Object storage is optional; inspect `packages/storage` when enabling it.
The persistent Node/MQTT/voice deployment remains separate work.
