# OpenHuli quick reference

Use the [README](../../README.md) for local setup and commands, [architecture](../architecture/architect.md)
for runtime ownership, and [the MVP specification](../mvp-spec.md) for scope.

- Develop the console: `pnpm dev` (loopback, port 3000).
- Generate/validate Prisma: `pnpm prisma:generate`, `pnpm prisma:validate`.
- Apply committed local migrations: `pnpm prisma:deploy`; seed the development tenant: `pnpm db:seed`.
- Typecheck/build dependencies: `pnpm typecheck`; production build: `pnpm build`.
- Deterministic tests: `pnpm test`; database setup/tests: `pnpm test:db:setup`, `pnpm test:int`.
- Browser journeys: `pnpm test:e2e` after following [the E2E guide](../../apps/e2e/README.md).
- Static checks: `pnpm lint`, `pnpm arch:check`, `pnpm prompt:check`.

Database tests require an exported local `TEST_DATABASE_URL`; they do not inherit the development
connection. Authentication and device features are incomplete; keep the scaffold local.
