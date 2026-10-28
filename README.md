# OpenHuli

An open-source control center for maker devices. The first release targets ESP32 push-to-talk
voice, AI-assisted API actions, and a weather station. See the [MVP scope](docs/mvp-spec.md)
and [backlog](https://github.com/orgs/oneway8x-com/projects/3).

**Current state:** a Next.js application with a reference todo feature and PostgreSQL persistence,
plus a persistent Node host with health checks, optional MQTT connection management, and an internal
socket probe. Owner access uses email OTP, server-verified sessions, and active Tenant membership.
Owner-only [device provisioning APIs](docs/guides/DEVICE_PAIRING.md) issue scoped credentials.
The [authenticated voice gateway](docs/guides/VOICE_GATEWAY.md) composes a
[Gemini conversation adapter](docs/guides/LIVE_CONVERSATIONS.md), shared voice/text turns, and the
authorized tool executor. Device context is the first registered read. Live-provider validation is
opt-in; forecasts/notes tools, MQTT telemetry, speaker playback, and the console remain later tickets.

## Local setup

Requires Node.js 22.19+ (see `package.json`), pnpm 10.26.0, and Docker Compose.
Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
docker compose -f docker-compose.local.yml up -d --wait
pnpm prisma:generate
pnpm prisma:deploy
pnpm owner:bootstrap
pnpm build:packages
pnpm dev
```

Open [localhost:3000/todos](http://localhost:3000/todos). The database listens on loopback port 5434;
Next development binds to loopback. Set `OWNER_EMAIL` in `.env` before bootstrap. The operator-only
command creates the owner, Home tenant, and OWNER membership; repeated runs are safe. Sign in
with that email and the OTP printed in the development server terminal. The Docker volume preserves
local data. Production requires an explicit signing secret, application origin, and email delivery
configuration; see [environment setup](docs/guides/ENV_SETUP.md).

The example connection is for the local Compose database. Check `.env` before running a migration
or seed; never copy a remote connection into this setup. `pnpm prisma:deploy` applies committed
migrations; `pnpm prisma:migrate --name <description>` creates a new development migration.

## Checks

After client generation, these checks need no live database:

```sh
pnpm typecheck
pnpm lint
pnpm arch:check
pnpm prompt:check
pnpm prisma:validate
pnpm test
pnpm build
```

Typechecking builds the shared packages it consumes. Unit tests exercise auth handlers and identity
use cases. Database-backed tests also verify two-tenant access, revocation, OTP races, and refresh replay:

```sh
docker compose -f docker-compose.local.yml exec -T postgres createdb -U openhuli openhuli_test
export TEST_DATABASE_URL="postgresql://openhuli:openhuli@127.0.0.1:5434/openhuli_test"
pnpm test:db:setup
pnpm test:int
pnpm --filter @corely/e2e exec playwright install chromium
pnpm test:e2e
```

Create `openhuli_test` once. Tests reject remote hosts, development database names, and connection
overrides. E2E starts its own Next.js process on loopback port 3100, creates synthetic owner sessions per
case, and cleans only test-owned rows. See [the browser-test guide](apps/e2e/README.md).
[CI](.github/workflows/ci.yml) runs these checks against a disposable PostgreSQL service.

Stop local PostgreSQL with `docker compose -f docker-compose.local.yml down`; keep its volume
unless you deliberately want to delete local data.

## Architecture and contributions

- `apps/app`: Next.js UI and synchronous HTTP routes.
- `packages/modules/*`: feature use cases and repositories; `todos` is the reference.
- `packages/contracts`: shared schemas; `packages/data/prisma`: schema and migrations.
- `apps/e2e`: real browser → Next routes → local PostgreSQL tests.
- `apps/runtime`: persistent Node host for sockets and optional MQTT connections. Start it with
  `pnpm dev:runtime`; see the [runtime setup and trust boundaries](docs/guides/PERSISTENT_RUNTIME.md).
  Vercel can host the console/HTTP surface, not this persistent process.

Read [AGENTS.md](AGENTS.md), [architecture](docs/architecture/architect.md), and
[security limits](docs/guides/SECURITY.md). Keep changes small and record useful decisions and checks
in a [task diary](tasks/TEMPLATE.md). Legacy package scopes remain `@corely/*`; avoid unrelated renames.

## License

[MIT](LICENSE). The maintainer selected MIT for OpenHuli; package metadata uses the same license.
The original Corely AI copyright notice is preserved. Third-party dependencies retain their own licenses.
