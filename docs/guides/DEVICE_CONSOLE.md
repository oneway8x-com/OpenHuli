# Device console

Open **Devices** after signing in as the owner. The console uses the existing owner session and
Tenant permissions. No provider key is sent to the browser or device.

## Pairing and credentials

1. Choose a name, room and profile: weather station (temperature/humidity/ping) or ESP32 voice
   (microphone/ping). Only enable display or speaker when the device actually supports it. Set the
   real display character limit. A location label requires both coordinates.
2. Pair the device and save its one-time configuration privately. It contains the validated profile,
   capabilities, exact MQTT topics, purpose-specific credentials and MQTT username/client ID. Voice
   devices receive separate voice and MQTT credentials; weather stations receive MQTT only.
3. Use the installation's verified WSS `/voice` URL and TLS broker endpoint. The runtime HTTP address
   is an internal server hop and is not the firmware's public endpoint. See
   [pairing](DEVICE_PAIRING.md), [voice](VOICE_GATEWAY.md) and [MQTT](MQTT_TELEMETRY.md) for wire setup.
   The device still advertises its manifest using the configured capabilities; the server validates it.
4. Hide the configuration after saving it. It is held only in page memory, never in browser storage or
   query caches. Reloading cannot recover a token. Rotate a credential to replace it, then install the
   new one-time token. Revocation immediately prevents subsequent authenticated operations; presence
   can remain visible until its freshness interval expires.

## Readings and commands

The runtime must run with `RUNTIME_VOICE_ENABLED=true` to serve owner management, and
`RUNTIME_MQTT_TELEMETRY_ENABLED=true` with the configured broker for readings and commands.
`OPENHULI_RUNTIME_HTTP_URL` in Next.js points to that runtime's internal origin (loopback HTTP or
verified HTTPS). Management remains available without a Gemini key. Provider sessions are not opened
by this page. Production broker and firmware setup are still required for actual hardware effects.

Readings poll every five seconds. Presence and sensor freshness are separate: `online` requires a
recent observation in the current runtime epoch, while `unknown` does not establish connectivity.
Sensor samples show measured source times, units and failures. The chart shows up to the latest 100
samples within 24 hours; it is not an aggregate of every retained reading or a forecast.

Ping and display commands enter the same registered tool executor used by conversations. Exact
arguments and target are shown before approval unless an existing owner preauthorization permits the
write. Capability, active credentials, current grants, presence and dispatch deadlines are rechecked.
Only an actual matching receipt confirms success. Missing acknowledgements stay unknown; do not
repeat an uncertain physical action without checking the target. Deny or cancel stops an undispatched
action. Cancellation after dispatch cannot undo an effect.

The URL retains only a device and command/request identity. Reload reads status, including recovery of
a lost HTTP receipt; it never sends a command, approves one, or reconnects an action automatically.
A failed lookup keeps new commands blocked until the owner explicitly clears it after checking the
device. Manual runs expire after 15 minutes; executor approval/dispatch deadlines remain shorter.
Operational activity is also available under Conversations; raw audio and transcript persistence remain
off by default.

## Grants and integrations

Device tool grants have an exact target for device tools, an expiry within one year, and can be
revoked. Tenant tools use no target IDs. A grant permits a device to request a tool; it does not supply
owner consent to a write. The shared registry includes measured telemetry reads and device commands
when MQTT telemetry is composed.

Forecast latitude, longitude, timezone, units and tool enabled flags are stored per Tenant in the
existing integration table. Until first save, the runtime's `HTTP_WEATHER_*` and `HTTP_NOTES_*`
configuration supplies defaults. Once saved, settings persist across runtime restarts. Disabling a
tool removes it from future dispatches and pending approvals; an action already sent can still finish.
New forecast calls use the saved location. Changing it invalidates a previously captured forecast tool
policy. Current provider sessions may still advertise a disabled tool, but authorization rejects it.

The notes destination, private-loopback allowance and `NOTES_API_TOKEN` stay under server configuration
as described in [HTTP tools](HTTP_TOOLS.md). The console cannot change destinations, read secrets or
return secret references. To replace the notes token, update the server configuration and restart the
notes API and runtime. This keeps secret storage proportional to a single-maintainer installation.

Save settings before testing. Forecast tests make a bounded real Open-Meteo GET and validate the
response. Notes tests call the configured service's authenticated `GET /health`, expecting
`{"ready":true}`; custom compatible notes services must implement that endpoint. No note is created,
no AI is called, and raw upstream errors are never displayed. A successful probe confirms the read
connection, not that a later write will succeed.

## Verification

The browser suite uses real authentication, PostgreSQL, executor policy and a separate SQLite notes
API. Only the AI/forecast response and device transport are synthetic. It covers pairing, rotation,
revocation, grants, stale/fresh readings, approvals, denial, unknown receipts, refresh without replay,
read-only probes and responsive layouts. Runtime integration tests cover duplicate delivery, changed
arguments, forged scope, secret redaction and disabling pending tool approvals. These checks do not
establish physical hardware, public TLS, broker delivery or live Gemini acceptance.
