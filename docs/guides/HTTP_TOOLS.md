# Forecast and notes HTTP tools

Issue [#11](https://github.com/oneway8x-com/OpenHuli/issues/11) provides `createHttpTools` and
`createHttpToolRegistry` in `@corely/modules-http-tools`. Compose these server-side with the
[shared executor](../architecture/authorized-tool-execution.md). Pass its registry in
`ToolDependencies`; use `submitToolCall`, owner consent and `dispatchToolExecution` for both AI and
manual actions. The shared conversation runtime exists, while composing these HTTP tools into
the reproducible voice-to-API scenario is tracked in #12. This adapter handoff alone does not
establish a complete live voice-to-API deployment.

## Registration and secret ownership

`readHttpToolsConfig(process.env)` enables a tool only when its required settings exist. Supply a
`SecretStore` that resolves a registered reference to a server-held token. The demo reference is
`notes-demo`, backed by `NOTES_API_TOKEN`; real deployments can use a secret manager instead. Never
expose environment values, references chosen by a model, raw provider errors, or authorization headers
to AI context or browser code. HTTP response bodies are not included in normalized errors.

A tool revision automatically includes a fingerprint of its configured URL/location/units and
secret reference. Changing a destination invalidates previous approvals and preauthorization instead
of redirecting an already approved action. Adapter behavior/schema changes still require a version
bump. Tool arguments cannot override host, method, path, credentials, headers or network policy.

`jsonOperation` provides the lower-level typed fixed GET/POST mapping for additional server-registered
operations. Use `defineTool` and the shared executor around it; do not expose `JsonHttpClient` as a
model-selectable URL tool. POSTs propagate the executor's stable `Idempotency-Key`. No client-side
retries occur; registered reads have at most two shared-executor attempts, writes exactly one.

## Forecast configuration

Set all three `HTTP_WEATHER_LATITUDE`, `HTTP_WEATHER_LONGITUDE`, and `HTTP_WEATHER_TIMEZONE` to enable
`weather.forecast`. The timezone must be a valid IANA timezone. `HTTP_WEATHER_TEMPERATURE_UNIT` is
`celsius` (default) or `fahrenheit`. Example synthetic location: `52.52`, `13.41`, `Europe/Berlin`.
Arguments contain only `{ days: 1 }` (one to three days; defaults to one).

The fixed HTTPS Open-Meteo forecast endpoint returns daily minimum/maximum temperature and maximum
precipitation probability. Mapping validates array lengths, numeric values and configured units and
timezone, then adds fetch time, configured coordinates and attribution. Results explicitly say
`kind: forecast`; these are model forecasts, not measured device sensor readings. Keep the returned
[Open-Meteo attribution](https://open-meteo.com/) and
[CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/) visible when displaying the data.
See the provider's [API documentation](https://open-meteo.com/en/docs) and usage terms before operating
outside the noncommercial demo.

After `pnpm install --frozen-lockfile && pnpm build:packages`, run `pnpm smoke:http weather`.
This makes a real forecast GET through the registered adapter (Berlin example if location settings are
empty) and prints a bounded attributed result. It is an **adapter smoke**, not a voice, authentication
or deployed end-to-end test. Network/provider failure exits nonzero; mocks never count as this live gate.

## Separate persisted notes demo

The `@corely/notes-api` app is a separate loopback-only HTTP service. It uses a local SQLite file,
independent of OpenHuli's PostgreSQL tables. Node 22.19+ is required; Node's SQLite support may emit an
experimental warning. WAL and full synchronous commits preserve note receipts and idempotency across
process/repository restarts. Startup applies versioned local migrations using SQLite `user_version`;
newer unknown versions fail closed without resetting data. No new npm runtime dependency is required.

1. Set `NOTES_API_TOKEN` to a random 32–256 character token using letters, digits, `_` or `-`.
2. Start `pnpm dev:notes`. Defaults: loopback `127.0.0.1`, port `3300`, database `.local/notes.sqlite`
   relative to the notes app. `NOTES_API_HOST` permits only `127.0.0.1` or `::1`; adjust
   `NOTES_API_PORT` and `NOTES_API_DATABASE` as needed. `.local/` is ignored by Git.
3. Set `HTTP_NOTES_URL=http://127.0.0.1:3300/notes`, `HTTP_NOTES_PRIVATE_DEMO=true`, and
   `HTTP_NOTES_SECRET_REF=notes-demo`. The exact URL must match the demo listener, including port/path.
   A secret resolver must map that reference to the same token.
4. `notes.create` accepts only `{ text: "A bounded note" }` (up to 2,000 characters). Grant device access
   where applicable, then supply owner preauthorization or exact approval through the shared executor.
5. Run `pnpm smoke:http notes` to perform a real POST twice under one identity and verify the same
   persisted note ID. This explicitly writes a synthetic note to the configured demo API.

Both `POST /notes` and `GET /notes` require the service bearer token, `X-Tenant-Id` and
`Idempotency-Key`. POST accepts only JSON `{ text }` and returns 201 with the committed note; an exact
repeat returns the same receipt, changed text under the same identity returns 409. GET only queries
that Tenant/key and supports reconciliation; 404 is not proof that an uncertain write never happened.
The demo service trusts the authenticated backend to assert Tenant scope. Its service token must never
be distributed to browsers, devices or AI providers. It has no public signup or owner-cookie flow.

## Network and outcome rules

Public operations require HTTPS and valid certificates. All resolved IPv4/IPv6 addresses must be
public unicast; private, loopback, metadata, multicast, mapped and reserved ranges are denied. DNS is
resolved once per request and the selected checked IP is pinned to the connection while preserving
TLS hostname verification. A later DNS answer cannot redirect that connection. Every request rechecks
DNS; mixed public/private answers fail closed. System proxy environment variables are not honored.

All redirects are rejected. There is no cookie jar, automatic redirect credential forwarding,
compression or arbitrary method support. JSON request/response bodies are capped at 16 KiB, responses
must have JSON content type and bounded JSON shape, and cancellation/deadlines close network work.
The only private exception is an explicit exact loopback IP demo URL; DNS hostnames, wildcard networks,
query strings and embedded credentials cannot widen it. Remote private integrations need a separately
reviewed adapter, not a broad allow-private switch.

Only a validated 200 forecast or 201 persisted note receipt counts as success. A 202, timeout,
connection loss or invalid/mismatched write receipt remains unknown in the shared ledger; the client
never repeats the POST. Notes reconciliation performs a GET with the original Tenant/idempotency key
and checks the returned text and identity before confirming success. Missing/failed lookup stays
unknown. Provider or process cancellation cannot undo a note already accepted externally.

## Verification

Unit tests use loopback HTTP servers for status, redirects, deadlines, size/type limits and secret
mapping. SQLite tests verify restart persistence and Tenant isolation. PostgreSQL integration tests
exercise the **actual shared executor and real notes HTTP service** with authenticated owner sessions,
concurrent/repeated delivery, repository restart and remote acceptance before timeout. Run with the
explicit disposable local `TEST_DATABASE_URL` after `pnpm test:db:setup`:

```sh
pnpm test
pnpm test:int
pnpm smoke:http weather
# With the separately started/configured notes demo:
pnpm smoke:http notes
```

Do not substitute deterministic tests for the live forecast smoke or claim hardware/voice coverage.
