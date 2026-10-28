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

The persistent host validates its `RUNTIME_*` settings independently. Its internal diagnostic token
is not an owner or device credential. See the [persistent runtime guide](PERSISTENT_RUNTIME.md) for
settings, `.env` loading, MQTT TLS, lifecycle checks, and cross-process trust boundaries. Device voice
and verified external deployment remain separate work; this is not a Vercel-only deployment.

Voice transport is opt-in through `RUNTIME_VOICE_ENABLED`. When enabled, `DATABASE_URL` must be a
valid PostgreSQL connection. `GEMINI_API_KEY` selects the server-only Gemini adapter; without it,
voice remains unconfigured/503. `AI_MAX_TOOL_CALLS` (default 6, range 1–16) and `AI_TURN_TIMEOUT_MS`
(default 25000, range 100–30000 ms) bound the committed model/tool loop. See
[live conversations and opt-in provider validation](LIVE_CONVERSATIONS.md). See [voice gateway setup and limits](VOICE_GATEWAY.md). Defaults and bounded
queue/operation/turn/session limits are in `.env.example`; provider keys remain server-only.

Device commands use authenticated MQTT telemetry mode and the shared executor.
`RUNTIME_COMMAND_ACK_TIMEOUT_MS` defaults to 5000 (100–15000 ms). Owner consent and exact device
grants still apply; success requires a timely device receipt. See [device commands](DEVICE_COMMANDS.md).

Registered HTTP tools validate `HTTP_WEATHER_*` and `HTTP_NOTES_*` separately. The notes demo validates
`NOTES_API_*` and binds only to loopback. See [HTTP tools](HTTP_TOOLS.md) for the complete settings,
server-only secret references, exact private-demo opt-in, SQLite file location and live smoke commands.
