# Browser tests

This suite exercises the actual Next.js todo UI, `/api/todos` handlers, explicit use cases,
and PostgreSQL. It does not use removed signup/Workspace APIs or a separate API/Vite process.
It uses real owner sessions and cookies, with synthetic OTP delivery in the fixture.

Follow the root setup first: install, generate Prisma, and build shared packages. Create a separate
local `openhuli_test` database (the README shows the Compose command), then run from the root:

```sh
export TEST_DATABASE_URL="postgresql://openhuli:openhuli@127.0.0.1:5434/openhuli_test"
pnpm test:db:setup
pnpm --filter @corely/e2e exec playwright install chromium
pnpm test:e2e
```

`test:db:setup` applies committed migrations without resetting existing data. The guard rejects
remote hosts, non-test databases, and connection overrides. The Playwright config overrides both
`DATABASE_URL` and `DIRECT_DATABASE_URL`, starts a fresh Next process on `127.0.0.1:3100`, and
refuses to reuse a stale server. Leave this port free. No provider credentials or live AI are needed.

Each case creates a synthetic owner and Tenant, obtains cookies through the real OTP verification
handler, and cleans its own rows even on failure. The fixture captures OTP delivery through the
identity use-case port; it adds no public testing endpoint or authentication bypass.

The owner journeys cover login, logout/revocation, cookie storage, CSRF, and spoofed Tenant headers.
Three todo journeys cover create/persistence after reload, complete/reopen, and edit/delete, including
API assertions for the resulting state. `pnpm --filter @corely/e2e exec playwright test --list`
checks collection only. A skipped or merely collected test is not a passing run.
Failure traces/screenshots are generated under ignored `test-results/` and `playwright-report/`.
Use synthetic data and inspect artifacts before sharing them.
