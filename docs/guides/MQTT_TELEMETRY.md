# MQTT telemetry and grounded device context

The opt-in runtime ingests measured temperature/humidity from paired devices into PostgreSQL.
It uses the existing Tenant/device credentials and exact topics; no broker password database is
maintained. The console remains a separate process. Apply migrations before enabling ingestion.

## Local setup

Use the declared Node/pnpm versions and the root `.env`. Start PostgreSQL and apply development
migrations as described in [local setup](ENV_SETUP.md), then configure:

```dotenv
RUNTIME_MQTT_TELEMETRY_ENABLED=true
RUNTIME_MQTT_URL=mqtt://127.0.0.1:1884
RUNTIME_MQTT_USERNAME=openhuli-runtime
RUNTIME_MQTT_PASSWORD=<unique-server-only-password>
RUNTIME_MQTT_AUTH_TOKEN=<unique-random-base64url-token-at-least-32-characters>
RUNTIME_MQTT_AUTH_HOST=0.0.0.0
RUNTIME_MQTT_AUTH_PORT=3201
RUNTIME_TELEMETRY_INTERVAL_SECONDS=30
RUNTIME_TELEMETRY_RETENTION_DAYS=7
```

Generate separate random secrets, for example with `openssl rand -hex 32`. Keep them local.
`docker compose --env-file .env -f docker-compose.local.yml --profile mqtt up -d --build mqtt`
starts the supplied Mosquitto broker; `pnpm dev:runtime` starts its private authorization bridge
and the backend subscriber. The broker reconnects if the runtime starts later. Pair a device in
the console and use its one-time MQTT token, `mqttUsername`, and `mqttClientId` in the MQTT client.
Previously paired devices can derive these public reference fields using the shared devices
helpers, or rotate the MQTT credential in the console. Voice tokens cannot authenticate MQTT.

The Docker broker reaches the host bridge through `host.docker.internal:3201`. Binding the bridge
to all interfaces is needed for this local container arrangement: restrict that port to the broker
with host/network rules. The HTTP bridge requires its separate secret on every request. Do not
expose it as a public device API. The supplied plaintext broker port binds only to host loopback.
For physical devices and production, provide a private reachable broker listener with TLS and
trusted certificates; use `mqtts://` in production. The development Compose profile does not supply production TLS. The separate
[deployment profile](DOCKER_DEPLOYMENT.md) provides verified MQTT TLS and a private broker bridge.

## Broker boundary

The image builds a small Mosquitto v5 plugin against the pinned 2.0.22 broker. Authentication binds
the credential to its canonical public Tenant/device/credential reference and client ID. Every
publish, subscription, and delivery rechecks active device and credential state through the shared
devices use cases. Device access is limited to its own exact topics from
[pairing](DEVICE_PAIRING.md); wildcards and cross-device traffic are denied. Revoked credentials
cannot publish or read even on an existing connection. Backend credentials stay server-side.

The broker appends authenticated `openhuli-identity` MQTT 5 metadata to telemetry/manifest packets;
the subscriber requires exactly one value, rejects client-supplied duplicates, and revalidates the
credential before ingestion. The private bridge observes presence during WRITE authorization,
which Mosquitto also performs when emitting Last Will. Mosquitto's normal MESSAGE plugin event
does not include Will messages. Presence is persisted before that authorization succeeds. The
retained flag on this private callback is storage intent: it is a live broker emission, not a replay.
Presence is not consumed again from retained subscriptions. A backend restart starts a new liveness
epoch, so old retained online state cannot establish connectivity.

The bridge fails closed on timeout, invalid input, or storage/authentication failure. Its callbacks
are synchronous and bounded to one second at the broker; this simple single-owner MVP design is
not a high-throughput broker authentication service. Lost acknowledgments may cause duplicate
telemetry, deduplicated by durable message ID and boot/sequence. The runtime bounds incoming packets
and its ingestion queue; rejected/dropped samples are not silently represented as measurements.

## Device packets and presence

Publish manifests, telemetry, and presence using [protocol v1](../protocol/openhuli-v1.md). Telemetry
has a 16 KiB limit, unsigned 32-bit sequence, boot ID, sample timestamp, `degC` temperature and
`percent` humidity (0–100). Unknown fields, wrong units, duplicate metrics, unsupported capabilities,
non-finite values, samples older than retention, and clocks more than five seconds ahead are denied.
A sensor failure is an explicit `sensorErrors` entry, not a fabricated value. All persisted rows
include the server receipt time and authenticated Tenant/device identity.

On each connection, publish `device.presence` online and configure an offline Last Will on the
same `/presence` topic. Within a boot, allocate increasing presence sequence pairs: online `2n`,
Will `2n+1`, then reconnect online `2n+2`. Telemetry has its separate increasing sequence. Change
`bootId` on reboot; never wrap a sequence. Graceful shutdown should publish offline before disconnect.
Duplicate/reordered messages do not refresh liveness. Firmware and network simulator changes are
separate issues; the broker integration suite uses synthetic real MQTT clients.

`connectivity` is `online` only after fresh live evidence in the current backend epoch, `offline`
after explicit offline evidence, otherwise `unknown`. Live evidence expires after three configured
intervals. `freshness` is independently `fresh`, `stale`, or `unavailable`, based on measured sample
time and readings; sensor errors remain explicit. A connected device can have stale measurements,
and an offline device can have a recent measurement. Broker disconnect invalidates online hints. After explicit offline evidence, queued telemetry
cannot restore online status: reconnect must publish a newer online presence (or start a new boot).

## Read tools and retention

`createTelemetryTools` registers `device.list`, `telemetry.latest`, and `telemetry.history` with the
shared durable tool executor. Composition can add them to its `ToolRegistry`; callers must use the
executor and committed turns. Device callers require current tool grants, including target device
grants for latest/history. Tenant context comes from authentication, never model arguments.
Outputs include `source: measured_sensor`, units, timestamps, freshness/connectivity, and errors.
These are room sensor measurements, not an external weather forecast.

The list returns at most ten active configured devices and an explicit `truncated` flag. History use cases accept at most 100 rows;
the tool caps output at ten and accepts nullable `from`/`to` ISO timestamps. All ranges stay inside
retention. Default retention is seven days (configurable 1–30), with startup/hourly tenant-scoped
cleanup. Latest reads also exclude expired samples. Presence remains separate from retained history.

## Verification

Use a disposable local test database, never a remote/shared database:

```sh
pnpm test:db:setup
pnpm test:int
pnpm test:migrations
docker build -t openhuli-test-mosquitto docker/mosquitto
TEST_MQTT_BROKER_IMAGE=openhuli-test-mosquitto pnpm test:broker
```

Set `TEST_DATABASE_URL` to an explicitly named local test database; the test scripts enforce that
boundary. Broker tests start their own synthetic-credential container and private bridge, cover
ACLs, malformed/oversized readings, Last Will, retained-online restart handling, and revocation,
and remove their container. They require Docker; CI builds the same image and runs these checks.

## Device execution receipts

When command services are composed, the backend also subscribes to broker-attested `/results` packets
and publishes non-retained commands through the existing backend ACL. Command IDs, acknowledgements,
expiry, deduplication and cancellation are handled by the [command feature](DEVICE_COMMANDS.md).
Telemetry ingestion never interprets a broker publish acknowledgement as physical execution.
