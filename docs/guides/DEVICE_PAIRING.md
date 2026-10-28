# Device pairing and credential lifecycle

Issue #7 adds owner-only provisioning APIs and shared device-access policy. The console's full
onboarding UI is tracked in #19. The [voice gateway](VOICE_GATEWAY.md) now composes voice authentication and revocation policy;
broker ingestion/ACL integration remains #13. Issuing credentials does not imply a deployed live
provider or reachable transport.
The runtime probe token is an operator diagnostic credential, never a device credential.

## Owner flow

Sign in through the existing owner OTP flow. Requests use the HttpOnly owner cookies and the exact
`APP_URL` origin; a device credential cannot call owner APIs. With an authenticated console session,
run an equivalent same-origin request through the console or an API client with its own cookie jar:

```js
const response = await fetch("/api/devices", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "Kitchen ESP32",
    room: "Kitchen",
    location: null,
    profileId: "esp32-voice",
    profileVersion: 1,
    capabilities: [
      {
        kind: "microphone",
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
          chunkDurationMs: 20,
        },
      },
      { kind: "ping" },
    ],
  }),
});
const provisioning = await response.json();
// Save credentials directly into the device's private configuration; do not log/share the response.
```

The server generates the device ID. The `201` response includes its owner configuration, exact MQTT
manifest/telemetry/results/commands topics, and separate `voice` and `mqtt` credentials with expiry.
Secrets are shown only in that issuance response. GET/list responses contain credential IDs, purpose,
expiry/revocation metadata, and grants; no plaintext secret or hash. Responses use `Cache-Control: no-store`.
The server stores only SHA-256 digests of 256-bit random secrets. Credentials default to 90 days.

Configure the device with its assigned ID, the appropriate purpose's token, the deployment's WSS
and MQTT TLS endpoints, and the trusted CA/time setup documented for that deployment. Do not infer
those endpoints from the Next console URL. The voice transport must accept only `voice` tokens;
MQTT authentication must accept only `mqtt` tokens. Owner cookies, provider keys, shared runtime
probe tokens, and tenant-wide API keys are not device configuration. Firmware delivery is tracked
separately and must store the tokens privately.

| Owner API                                             | Behavior                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/devices`                                    | List at most 100 configured devices in the authenticated Tenant.                    |
| `POST /api/devices`                                   | Pair one device and show its newly issued credentials once.                         |
| `GET /api/devices/{id}`                               | Read configuration and safe credential/grant metadata.                              |
| `POST /api/devices/{id}/credentials`                  | Rotate `{credentialId, purpose}`; show the replacement once.                        |
| `DELETE /api/devices/{id}/credentials/{credentialId}` | Revoke one credential.                                                              |
| `PUT /api/devices/{id}/grants`                        | Assign `{toolId, targetDeviceIds, expiresAt}` with a future expiry within one year. |
| `DELETE /api/devices/{id}/grants/{toolId}`            | Revoke that device's tool grant.                                                    |
| `DELETE /api/devices/{id}`                            | Deactivate the device, revoke all credentials/grants, preserve stored history.      |

Rotation consumes an unrevoked credential atomically; simultaneous rotations yield one replacement
and a `409` for the loser. Expired credentials can be rotated by the owner. Revoked credentials are
terminal: pair a replacement device if all credentials for a required purpose have been revoked.
After a lost issuance/rotation response, GET the device's credential metadata and rotate the newest
unrevoked ID. The original plaintext cannot be recovered. Deactivation does not delete history.

## Profiles and capabilities

`esp32-voice` version 1 requires microphone and ping. Speaker, display, temperature, and humidity
are optional and must be explicitly owner-configured. `weather-station` version 1 requires
temperature, humidity, and ping, with optional display. It receives no voice credential. There is
no inferred speaker/display. Microphone/speaker formats use the exact v1 PCM schema; display
advertisements may lower, but cannot raise, the owner's configured text limit.

A device POSTs its [v1 manifest](../protocol/openhuli-v1.md) to `/api/device/manifest` using
`Authorization: Bearer <mqtt-token>`. The server verifies credential, purpose, live device state,
exact device ID, required capabilities, and the owner-configured upper bound. The manifest cannot
change the profile, room/location, tool grants, or owner identity. Unknown fields are rejected.
Location is explicit owner data; no geolocation lookup or fabricated default is performed.
Legacy storage-only device rows have no validated owner configuration and cannot authenticate
through the pairing flow. Existing unscoped credentials remain `legacy`, not promoted to voice/MQTT.

## Transport integration and revocation

Use the devices package's public use cases:

- `authenticateScopedDevice(token, purpose, store)` creates trusted server session context. The
  encoded Tenant/device/credential IDs are untrusted lookup hints; the stored digest, binding,
  purpose, expiry, active device, and owner configuration must all match before returning authority.
- `authorizeDeviceMqtt(session, action, topic, store)` checks exact v1 topics. Publish permits only
  the own device's manifest, telemetry, and results; subscribe permits only its commands. Wildcards,
  other-device topics, and publishing commands are denied. Bind the broker's authenticated identity
  to that session; never accept a second client-chosen identity or a username as authority.
- `registerPairedManifest` persists the constrained manifest. MQTT ingestion must call it too;
  merely parsing a manifest or accepting a broker connection is not registration.
- `authorizePairedDeviceTool` requires the current grant and exact target. A grant is permission
  data, not an executor or tool registration. The shared executor in #8 must additionally validate
  registered schemas, exact target from arguments, approval rules, and dispatch state.
- Revalidate before every protected operation. `watchDeviceSession` additionally checks idle
  connections every 15 seconds and closes within 20 seconds on revocation or an unavailable DB.
  The transport supplies a close callback that terminates the socket/provider/broker session and
  stops further work, and calls the returned cleanup function on disconnect. New handshakes fail
  immediately after revocation. An already dispatched external effect is not undone or retried.

The voice gateway wires these guards for `/voice`. No broker authentication plugin or public
credential-check endpoint is added here. #13 must wire the broker guards before enabling MQTT
device access; default broker anonymous access must remain disabled. Routine checks use synthetic credentials and a disposable local database.
