# Single-host Docker deployment and recovery

Issue [#21](https://github.com/oneway8x-com/OpenHuli/issues/21) adds
[`docker-compose.deploy.yml`](../../docker-compose.deploy.yml). The existing developer Compose
and local OTP workflow remain available. This profile packages the built Next console, persistent
runtime, PostgreSQL 17, the existing authenticated Mosquitto plugin, and Caddy HTTPS/WSS routing.
It uses a separate `openhuli-deploy` project and data volumes, avoiding the development database.

## Trust boundaries

Only the HTTPS proxy and authenticated MQTT TLS listener publish ports. PostgreSQL, app HTTP,
runtime HTTP, broker authorization port 3201 and administrative/operator commands stay private.
Private service hops use the isolated Compose bridge; the console-to-runtime hop uses verified HTTPS,
and the runtime's MQTT connection uses verified TLS too. Public hostnames resolve to network aliases
inside the stack so internal clients validate the same certificate names as external devices.
Caddy forwards WebSocket upgrades and streams console events without buffering. Its admin API is off.
See the upstream [proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[TLS](https://caddyserver.com/docs/caddyfile/directives/tls) and
[Mosquitto TLS](https://mosquitto.org/man/mosquitto-conf-5.html) documentation.

All application roles use the same image with Node 22.19.0 and pnpm 10.26.0. The image keeps installed
workspace dependencies and migration tools to preserve pnpm links and Prisma behavior. It is intentionally
larger than a standalone console-only image. Applications run as the `node` user, with an init process,
forwarded shutdown signals and a 30-second stop grace period. Secrets are mounted only at runtime;
`.dockerignore` excludes environment files, local data, private keys, certificates and host dependencies.

## Local TLS stack

Install Docker Compose v2, Node/pnpm from `package.json`, and OpenSSL. From the repository root:

```sh
pnpm deploy:local:prepare
# Creates a NEW ignored deployment.local directory; never overwrites existing secrets.
# Configure OWNER_EMAIL, EMAIL_FROM, and the email_api_key file for real login before startup.
docker compose --env-file deployment.local/stack.env -f docker-compose.deploy.yml up -d --build --wait
docker compose --env-file deployment.local/stack.env -f docker-compose.deploy.yml run --rm --no-deps bootstrap
```

The generator creates separate random secrets and a two-day private CA/server certificate covering
`openhuli.localhost`, `runtime.openhuli.localhost`, and `mqtt.openhuli.localhost`. It does **not** install
trust on the host or configure paid services. The console is `https://openhuli.localhost:8443`, voice
is `wss://runtime.openhuli.localhost:8443/voice`, and MQTT is `mqtts://mqtt.openhuli.localhost:8884`.
Make these names resolve to loopback on the host if its resolver does not support `.localhost`.
Use the generated `tls/ca.crt` as a trusted CA explicitly; never use insecure TLS flags.
For a browser, install that local CA only into the intended test trust store and remove it afterwards.

The applications run in production mode, so real login needs verified email delivery: put the Resend
key in `secrets/email_api_key` and configure the owner/sender in `stack.env`. An empty key intentionally
fails startup. Use the existing developer setup for terminal OTP instead of weakening container auth.
The generator leaves `gemini_api_key` empty and voice disabled. Set the server-only provider key there,
then set `RUNTIME_VOICE_ENABLED=true` and recreate runtime/app to enable voice and owner management.
Configure forecast location and/or the exact notes HTTPS URL before performing an API smoke.

Secret files are read-only and mounted under `/run/secrets`; parent directories must stay mode 0700.
Files read by differing service UIDs use mode 0444 inside those private directories. The local CA
private key stays mode 0600 and is never mounted. Docker/host administrators can access mounted secrets;
standalone Compose secrets are not an encrypted vault. Keep recovery copies separately encrypted.
The entrypoint accepts an explicit `_FILE` allowlist and constructs the fixed private database URL;
this profile cannot accidentally migrate a remote database URL copied from a developer environment.

Health checks cover PostgreSQL availability, application login serving, runtime readiness and an
actual authenticated TLS broker subscription. Readiness failure is distinct from process liveness.
`RUNTIME_VOICE_ENABLED=true` without a key remains unready. A configured key does not prove a valid
provider account or working forecast/notes integration; those need the authenticated live smoke below.
The authorization bridge fails closed when the runtime/database is unavailable. No anonymous broker
listener, plain MQTT host port or Caddy admin port is exposed.

## Single cloud host

Provisioning a host, changing DNS/firewalls or deploying remotely is a separate operator action.
No cloud account or domain is assumed by these files. On the selected Linux host:

1. Check out the reviewed source revision. Record that SHA and built image digest; use the same image
   for app, runtime, migrate and bootstrap. Supply environment/secret files outside the checkout.
2. Replace the three hostnames with DNS names pointing to the host. Set `OPENHULI_BIND_IP=0.0.0.0`,
   `OPENHULI_HTTPS_PORT=443` and `OPENHULI_MQTT_PORT=8883`. Allow inbound 443 and 8883 only (plus separately
   restricted administrator SSH); keep 5432, 3000, 3200, 3201 and 2019 closed. No inbound home-router
   forwarding is needed: devices initiate outbound WSS and MQTT TLS connections to this host.
3. Put a publicly trusted PEM full-chain certificate covering all three hostnames into `tls/server.crt`,
   its matching key into `tls/server.key`, and the applicable root trust bundle into `tls/ca.crt`.
   Each device must have the proper CA roots and a reasonably correct clock before verifying TLS.
   Hostname verification must match the configured WSS/MQTT hostname. Do not ship the CA private key.
4. Inject independent signing, database, email, broker/bridge, notes and provider secrets. The bridge
   token is separate from device credentials and backend MQTT password. Devices receive only their
   one-time purpose-scoped credentials from pairing. Never place provider/API keys in firmware.
5. Start with `up -d --build --wait`, which waits for the private database and applies committed forward
   migrations before starting applications. Verify the target host/volumes before this deliberate
   mutation. Bootstrap the owner explicitly on the initial installation. Record health and TLS checks
   before directing devices at this host.

This profile loads operator-managed certificates. It does not provision or automatically renew them.
Renew before expiry and recreate proxy/mqtt so bind-mounted replacement files are reopened; recreate
app/runtime when the CA changes. Keep previous certificates available for recovery. Do not lower
TLS verification to work around DNS, clock or certificate errors.

Private external APIs need an explicit reachable route and a registered destination policy. Default
HTTP tools reject arbitrary private destinations even if Docker can route to them. This profile
preserves that SSRF boundary: notes uses the configured public HTTPS endpoint, and the exact loopback
demo remains a separate local development workflow. Do not expose the broker bridge as an API proxy.

## Verification and live acceptance

`pnpm test:deployment` builds and starts unique disposable Compose projects with synthetic credentials
and a temporary CA. It checks HTTPS trust, authenticated WSS rejection before provider startup, MQTT
TLS/authentication/ACL denial, private surfaces, dependency loss, persisted unknown write identity,
quiesced backup, isolated restore and refusal to overwrite an existing restore volume. The test uses
synthetic email/provider keys only to configure the authentication boundary; **no provider request or
email is sent**. Its cleanup removes only smoke-owned projects/volumes. Deployment CI runs this suite
separately from normal tests. It needs a responsive Docker daemon, free ports 8443/8884 and sufficient
disk for the full image. Existing local services are never stopped to free those ports.

That smoke does not establish cloud or physical-device acceptance. On the selected cloud host, record:

- Actual `openssl s_client` certificate chain/hostname verification for HTTPS/WSS and MQTT TLS,
  plus anonymous/wrong-device/cross-device broker denials. Check the clock/trust store on the ESP32.
- Pair a device, assign exact grants, and run the [simulator live workflow](DEVICE_SIMULATOR.md) with
  recorded PCM, then repeat with the real ESP32 microphone. Complete a live forecast GET and an
  explicitly approved notes POST. Record IDs and safe receipts, with no secrets/audio in shared logs.
- Confirm truthful text/audio playback and required acknowledgement timing, preserving partial/unknown
  status when effects are uncertain. A provider progress message is not the useful-response latency.
- Restart the host, reconnect with a new device boot/presence sequence, and inspect preserved device,
  conversation and execution identities. Interrupted voice is discarded and never replayed.
- Record backup/restore and unavailable-provider/API/broker/database behavior with the actual image SHA,
  model, provider, firmware and TLS names. Keep live acceptance separate from deterministic CI results.

## Backup, restore and rollback

From the repository root, with the intended deployment environment:

```sh
sh docker/deploy/backup.sh deployment.local/stack.env deployment.local/backup-001
# Restores only into NEW named volumes, never over the running installation:
COMPOSE_PROJECT_NAME=openhuli-recovery-001 sh docker/deploy/restore.sh deployment.local/stack.env deployment.local/backup-001
```

Backup temporarily stops app/runtime/mqtt, preserving a consistent PostgreSQL custom-format dump and
broker persistence archive, then restarts those services without rerunning migrations. The proxy may
return unavailable while quiesced. SHA-256 checksums and image identities accompany the private backup.
Secrets/certificates are excluded; preserve encrypted copies separately. A backup failure is not a
usable archive; inspect its result before attempting restore. Protect backup files as sensitive data.

Restore verifies checksums and refuses if either target data volume exists. It starts only the new
private database, restores schema/data and broker storage, and leaves application startup explicit.
It does not open public ports or modify the original project. Use the backup's exact compatible image,
then deliberately apply necessary forward migrations before starting the restored services. Stop the
original stack or use different public ports before starting a recovery project. Test restored scoped
credentials, device history and unknown execution identity; never recreate or redispatch uncertain
writes. An older backup also rolls back revocations, grants, budget counters and ledger entries
created after that backup. Before public cutover, rotate/revoke credentials affected by the recovery
point and reconcile external effects since the snapshot. A missing restored ledger entry is not proof
that an effect never happened. Keep the original stack quiesced during cutover and preserve its data
until recovery is verified.

For application rollback, retain the previous image digest and select it via `OPENHULI_IMAGE` using
`up --no-build`; do not silently rebuild a rollback tag. Database migrations are forward-only and
rollback does not undo schema or external effects. Check compatibility; otherwise restore into a new
isolated project and validate it before cutover. `down` preserves data; use `down --volumes` only for
explicitly disposable test projects. Never use a global Docker prune as a deployment/recovery step.
