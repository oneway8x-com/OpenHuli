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

Conversation tests also start a private runtime on `127.0.0.1:3218` with real authentication,
conversation persistence and executor policy, using a synthetic provider/effect port. Keep that port
free as well. No production testing switch or provider credential is added. The console journeys
cover approval/denial, uncertain and partial outcomes, reload without replay, source timestamps,
safe rendering and mobile layout. Both servers use the guarded disposable test database.

Device-console journeys exercise pairing, one-time credential handling, rotation/revocation, grants,
fresh/stale measurements, manual command approval/denial, unknown acknowledgements, reload without
replay and integration settings. They use the same private test runtime, actual executor and local
notes API with a synthetic device publisher. No hardware, public broker or live provider is involved.
Owned command rows are removed before their execution records during fixture cleanup.
