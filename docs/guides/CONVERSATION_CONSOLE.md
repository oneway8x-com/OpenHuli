# Conversation console

Open `/conversations` after signing in as the configured owner. Choose a provisioned active device
and start a conversation. Typed turns enter the same conversation runtime, provider adapter and
registered executor as device voice. Device context is always registered. Configure the [HTTP tools](HTTP_TOOLS.md) to enable attributed
`weather.forecast` reads and consent-controlled `notes.create` writes in both voice and console.
The console is text-only; device/simulator audio playback remains on the authenticated voice path.

## Setup and trust boundaries

Run the persistent runtime and Next app with the same database, `OWNER_EMAIL`, `JWT_SECRET` and
`APP_URL`. Enable `RUNTIME_VOICE_ENABLED=true` and configure the runtime's `GEMINI_API_KEY` to start
live console conversations. Existing activity can be read without an AI key while the runtime is
running. No new migration is required.

The Next server uses `OPENHULI_RUNTIME_HTTP_URL` (default `http://127.0.0.1:3200`) as a **server-only**
origin. HTTPS is required beyond loopback. It must have no path, credentials, query or fragment.
The Next API authenticates the HttpOnly owner cookie and applies existing same-origin/CSRF checks
before proxying. It forwards only the access bearer to the fixed runtime console paths; cookies
and provider keys never reach client JavaScript or provider context. Redirects are rejected.
Configure `APP_URL` as the exact browser origin; there is no CORS or public credential bypass.

The runtime independently verifies the signed access token and active owner session on each
request. It rejects browser Origin headers; the intended browser entry is the same-origin Next
proxy. Reads include the authenticated Tenant in every repository query. The owner can review
activity in their Tenant; Tenant headers/body fields cannot choose another Tenant. Console sessions
also bind new turns to the original login session. Device voice retains its device grants; owner
turns use the executor's established owner policy. Writes still require exact approval or existing
explicit owner preauthorization, never consent inferred from model text.

## Activity, approvals and reconnect

Live answers and execution notifications use authenticated SSE; snapshots refresh operational
activity as a fallback. The page waits for its live stream before allowing a message. A reconnect
only subscribes/reads: it never submits a turn or repeats a write. The server binds turn identity
to a hash of its text, accepts an identical retry without another execution, and rejects changed
text under the same identity. No browser storage contains transcripts or access tokens.

Each card shows server status, target, exact visible arguments, execution ID and timestamp.
Expand the result to inspect source/observation timestamps returned by the registered tool;
configured device context is not a live sensor reading. Partial and unknown are separate from
confirmed. Model language never determines a card's success state; partial/unconfirmed results
suppress model success claims and speech in the shared runtime.

Approval submits the exact execution ID, approval ID, request hash and target shown in the card.
The executor rechecks the stored argument snapshot, originating actor, policy, expiry, grants and
turn state. A changed target/hash, foreign execution or repeated approval cannot repeat a write.
Sensitive named fields are redacted; an action whose arguments cannot be fully reviewed is not
approvable in this UI. Deny and cancel use the same executor use cases as other callers.

Approvals wait within the existing model-turn budget (25 seconds by default, maximum 30 seconds),
which can be shorter than the approval record's expiry. If the turn stops first, pending work is
cancelled and cannot be dispatched later. Approval does not restart or replay a stopped turn.
Cancelled/unknown outcomes block further automatic actions in that provider session; start a new
conversation only after checking the target where necessary.

Stop aborts the turn and closes its provider session. Already-started external writes may remain
unknown; cancelling is not an undo. Read-only activity remains available. Provider sessions expire
at the earlier of five minutes or owner access expiry; at most 32 are held per runtime process,
with one active turn and at most 100 turn identities each. SSE allows one subscriber per console
session and revalidates the owner every five seconds. Logout/revocation prevents new requests and
tool dispatch; a live read stream is closed on that next revalidation. Slow streams close rather
than accumulate an unbounded queue. Process shutdown drains console/voice sessions before closing
the shared persistence connection.

## Retention and evidence

Transcript retention remains off by default: refresh restores permitted turn/tool metadata but
not prior text. Transcript-enabled historical records display their bounded saved text. Operational
tool arguments/results remain for execution integrity, with secret-named fields redacted from this
view; transcript-off is not a deletion policy for all operational data. Raw audio is not stored.
After a runtime restart, activity is read only; create a fresh conversation to send new turns.

Automated tests use real owner authentication, routes, PostgreSQL, runtime and executor with a
synthetic provider and effect port. They cover exact approval binding, denial/cancel, partial and
unknown outcomes, safe text rendering, source timestamps, reload without replay, narrow screens,
and authentication/CSRF/Tenant boundaries. The browser host lives only under `apps/e2e/support`;
production startup never loads its synthetic adapter. The notes journey performs a real local HTTP POST into a separate SQLite store; forecast payloads
and AI are deterministic fixtures. No live Gemini/Open-Meteo or physical hardware result is implied.

Choosing **New conversation** closes the selected live provider session before opening its replacement.
Its existing activity remains readable; daily budget allocations are not refunded. This prevents
sequential conversations in one tab from consuming all concurrent-session slots.
