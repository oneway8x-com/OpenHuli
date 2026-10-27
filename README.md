# OpenHuli

An open-source control center for maker devices. The first release targets ESP32 push-to-talk
voice, AI-assisted API actions, and a weather station. See the [MVP scope](docs/mvp-spec.md)
and [backlog](https://github.com/orgs/oneway8x-com/projects/3).

**Current state:** a Next.js application with a reference todo feature and PostgreSQL persistence.
Device pairing, MQTT, streaming voice, and AI execution are planned, not implemented. Todo routes
still use development tenant context; keep this scaffold local until [owner authentication](https://github.com/oneway8x-com/OpenHuli/issues/3)
is complete. Do not expose it as a public authenticated device service.

## Local setup

Requires Node.js 22.19+ (see `package.json`), pnpm 10.26.0, and Docker Compose.
Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
docker compose -f docker-compose.local.yml up -d --wait
pnpm prisma:generate
pnpm prisma:deploy
pnpm db:seed
pnpm build:packages
pnpm dev
```

Open [localhost:3000/todos](http://localhost:3000/todos). The database listens on loopback port 5434;
Next development binds to loopback. The seed creates only the development tenant, not an owner
account or an authorization policy. The Docker volume preserves local data.

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

Typechecking builds the shared packages it consumes. Unit tests include the app's real auth
handlers with mocked persistence; they do not claim the todo API has authenticated tenant isolation.
Database-backed repository tests are separate:

```sh
docker compose -f docker-compose.local.yml exec -T postgres createdb -U openhuli openhuli_test
export TEST_DATABASE_URL="postgresql://openhuli:openhuli@127.0.0.1:5434/openhuli_test"
pnpm test:db:setup
pnpm test:int
pnpm --filter @corely/e2e exec playwright install chromium
pnpm test:e2e
```

Create `openhuli_test` once. Tests reject remote hosts, development database names, and connection
overrides. E2E starts its own Next.js process on loopback port 3100, creates a unique tenant per
case, and cleans only test-owned rows. See [the browser-test guide](apps/e2e/README.md).
[CI](.github/workflows/ci.yml) runs these checks against a disposable PostgreSQL service.

Stop local PostgreSQL with `docker compose -f docker-compose.local.yml down`; keep its volume
unless you deliberately want to delete local data.

## Architecture and contributions

- `apps/app`: Next.js UI and synchronous HTTP routes.
- `packages/modules/*`: feature use cases and repositories; `todos` is the reference.
- `packages/contracts`: shared schemas; `packages/data/prisma`: schema and migrations.
- `apps/e2e`: real browser → Next routes → local PostgreSQL tests.
- A separate persistent Node runtime for WSS/MQTT is planned in [#5](https://github.com/oneway8x-com/OpenHuli/issues/5).
  Vercel can host the console/HTTP surface, not that persistent runtime.

Read [AGENTS.md](AGENTS.md), [architecture](docs/architecture/architect.md), and
[security limits](docs/guides/SECURITY.md). Keep changes small and record useful decisions and checks
in a [task diary](tasks/TEMPLATE.md). Legacy package scopes remain `@corely/*`; avoid unrelated renames.

## License

[MIT](LICENSE). The maintainer selected MIT for OpenHuli; package metadata uses the same license.
The original Corely AI copyright notice is preserved. Third-party dependencies retain their own licenses.
