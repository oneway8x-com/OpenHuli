# Persistent runtime

`apps/runtime` is the single always-on Node host for future voice, MQTT, and conversation use cases.
Next.js continues to own the console and synchronous HTTP routes. Run the persistent process on a
long-lived Node/container host, alongside PostgreSQL and a broker when configured. Hosting only the
Next app on Vercel does not host persistent connections.

This foundation implements process/socket lifecycle, MQTT connection management, typed configuration,
and health/readiness. It does not implement device pairing, authenticated audio, telemetry ingestion,
or provider execution. Those remain issues #7, #9, #13, and #10. Existing Next auth helpers are not
imported: their current permissive Tenant/JWT behavior must not become runtime authority.

## Run locally

From the repository root, using the declared Node/pnpm versions:

```sh
pnpm install --frozen-lockfile
cp .env.example .env # only if you do not already have one
pnpm dev:runtime
```

This builds shared packages once, then starts Node's watch mode. Source reloads and SIGTERM/SIGINT
stop the old process and its owned resources. Keep the default loopback bind. PostgreSQL, MQTT,
provider credentials, and a probe token are unnecessary for a health-only start. The console still
starts separately with `pnpm dev`.

Check [liveness](http://127.0.0.1:3200/health/live) and
[readiness](http://127.0.0.1:3200/health/ready). For a built process:

```sh
pnpm build
pnpm start:runtime
```

The build creates `apps/runtime/dist/main.mjs`; retain installed production dependencies when
packaging it. The workspace package is `@corely/runtime`, while imports of shared contracts and
future feature use cases retain the existing `@corely/*` scopes.

## Configuration

The development and start scripts read the root `.env` if present; explicit process environment
values take precedence. `readRuntimeConfig` validates at startup and reports invalid **key names**,
never received values. Config errors exit nonzero before listening. See [`.env.example`](../../.env.example).

| Variable                                         | Default / validation                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `NODE_ENV`                                       | `development`; also `test` or `production`                                            |
| `RUNTIME_HOST`                                   | `127.0.0.1`; also `::1`, `0.0.0.0`, `::`                                              |
| `RUNTIME_PORT`                                   | `3200`, integer 0–65535; 0 selects an ephemeral port for tests                        |
| `RUNTIME_PROBE_TOKEN`                            | Empty disables probe; otherwise 32–256 ASCII letters, digits, `_`, `-`                |
| `RUNTIME_MQTT_URL`                               | Empty disables broker; `mqtts://` or development loopback `mqtt://`                   |
| `RUNTIME_MQTT_USERNAME`, `RUNTIME_MQTT_PASSWORD` | Optional pair; require broker URL; username up to 256, password up to 1024 characters |
| `RUNTIME_STARTUP_TIMEOUT_MS`                     | 5000; integer 100–30000                                                               |
| `RUNTIME_SHUTDOWN_TIMEOUT_MS`                    | 5000; integer 100–30000                                                               |
| `RUNTIME_IDLE_TIMEOUT_MS`                        | 30000; integer 100–300000                                                             |
| `RUNTIME_MAX_CONNECTIONS`                        | 100; integer 1–1000                                                                   |

Broker URLs cannot contain credentials, paths, queries, or fragments. Use the separate secret
variables. Production requires `mqtts://`, including for loopback; certificate verification remains
enabled. No automatic certificate/TLS bypass is provided. Broker access and ACL provisioning are
external setup; this ticket adds no broker container, subscriptions, commands, or telemetry writes.

## Health and connection probe

`GET /health/live` returns 200 while the process can serve requests during startup/running.
`GET /health/ready` returns 200 only after startup and while every configured dependency is ready;
otherwise 503. MQTT disconnect/error/reconnect removes readiness until a new connection is established.
Optional absent MQTT is reported `disabled`; absent AI and voice are `unconfigured`. Healthy here
means the configured host is ready, not that voice-to-action or any provider is available. Responses
contain only phase/status/counts; errors never expose broker/provider details or tokens.

For an opt-in persistent socket smoke check, generate a local service token:

```sh
export RUNTIME_PROBE_TOKEN="$(openssl rand -hex 32)"
pnpm dev:runtime
```

Connect a server-side WebSocket client to `ws://127.0.0.1:3200/internal/probe`, setting the
`Authorization: Bearer <token>` header. Send WebSocket **ping** frames and wait for pong; send at least
one before the idle timeout. Text/binary application messages close the probe. It supplies no Tenant
context or authorization to execute anything. The token is for internal diagnostics only: never give
it to firmware, a browser, or an AI provider. Browser Origin headers and query-string tokens are
rejected. Unknown paths, including `/voice`, stay closed. Payloads are capped at the shared v1 JSON
limit; compression is disabled, concurrent connections are capped, and idle peers are terminated.

## Feature and adapter integration

Transport code remains in `apps/runtime/src/runtime.ts`; configuration and MQTT adapters are separate.
`RuntimeDependency` owns startup, readiness, and shutdown of broker/provider connections. Startup
receives an abort signal; implementations must settle promptly when it aborts. `stop()` must release
all owned timers, sockets, and provider handles and be safe after partial startup. The MQTT adapter
uses MQTT 5, clean sessions, reconnects after outages, verifies TLS, and stops reconnecting on shutdown.
It does not queue/publish business writes.

`RuntimeConnectionHooks.opened` receives a generated connection ID and per-connection abort signal,
and synchronously returns a handle with asynchronous `close()`. Disconnect, idle expiry, startup
failure, shutdown, and watch reload abort owned work and close handles. Cleanup errors remove readiness and are reported as shutdown failure without logging their
sensitive messages. Pending cleanup counts against the connection limit and has the same deadline
as shutdown; a failed cleanup requires a process restart. Teardown of connection and dependency
resources runs concurrently after abort; hooks must not assume a dependency remains ready. Shutdown
rejects new upgrades, sends close code 1001, force-terminates unresponsive peers after at most 250 ms
(or half the shutdown timeout), and waits for cleanup within the configured deadline. Failure exits
the CLI nonzero; an adapter that ignores cancellation cannot keep a failed CLI process alive forever.

The authenticated device gateway in #9 must validate a scoped credential, resolve a server-owned
Tenant/device/conversation context, then call shared feature use cases through explicit ports.
Reuse the [v1 protocol parsers](../protocol/openhuli-v1.md). Do not put tool grants, approval decisions,
Prisma queries, or tenant selection into transport handlers. The service probe is not a shortcut for
that gateway and must never be repurposed as device authorization.

Next console sessions cannot be forwarded blindly between processes. Until the shared auth/session
and device credential features land, the host has no trusted user/device endpoint. Later server-to-server calls must verify issuer/audience/expiry and resolve actual Tenant membership/device binding
through the owning authentication feature. Do not trust `x-tenant-id`, device claims, cookie presence,
shared probe tokens, or a model-supplied Tenant ID. No duplicated permissive JWT verifier is added here.

## Deployment and checks

Deploy this as a single persistent Node service behind a TLS reverse proxy that supports WebSocket
upgrade and bounded idle timeouts. Use WSS externally, a private upstream, protected diagnostic paths,
and MQTT TLS/ACLs. Never run it inside a Next/Vercel serverless handler. Docker packaging, broker
provisioning, and verified cloud TLS deployment are issue #21; this change performs no deployment.

Runtime tests use real loopback HTTP/WebSocket listeners, fake broker/provider adapters, and child
processes. They cover startup failure/cancellation, dependency readiness/recovery, auth rejection,
idle/concurrency/payload bounds, abort/cleanup failures, signal shutdown and port reuse. Root
`pnpm test`, `pnpm typecheck`, and `pnpm build` include this app. No paid provider or live broker
is needed or implicitly contacted by tests.
