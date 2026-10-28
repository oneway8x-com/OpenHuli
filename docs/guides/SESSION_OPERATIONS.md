# Conversation limits, privacy and diagnostics

Issue [#20](https://github.com/oneway8x-com/OpenHuli/issues/20) applies the same controls to
Gemini-backed device voice and owner console sessions. Apply the additive migration before
starting the updated runtime. Existing data is preserved. No new external service is required.

## Limits and cost meaning

These server-only settings are chosen by the owner/operator, never by a device or model.
Values apply independently to each Tenant; concurrency/session/audio quotas additionally scope
to the selected device, including console conversations using that device.

| Setting                               | Default | Meaning                                                                           |
| ------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `AI_DEVICE_SESSIONS_PER_DAY`          | 100     | Admitted sessions per device per UTC admission day.                               |
| `AI_DEVICE_CONCURRENT_SESSIONS`       | 2       | Active provider leases per device across runtime processes.                       |
| `AI_DEVICE_AUDIO_SECONDS_PER_DAY`     | 1800    | PCM16 mono input, 32,000 bytes/second, across reconnects.                         |
| `AI_SESSION_AUDIO_SECONDS`            | 120     | Total input audio per session across turns.                                       |
| `AI_DAILY_BUDGET_MICROS`              | 1000000 | Tenant daily admission allocation, integer micro USD; zero disables new sessions. |
| `AI_SESSION_RESERVATION_MICROS`       | 10000   | Nonrefundable allocation reserved before opening each provider session.           |
| `AI_INPUT_MICROS_PER_MILLION_TOKENS`  | unset   | Optional owner-supplied conservative input estimate rate.                         |
| `AI_OUTPUT_MICROS_PER_MILLION_TOKENS` | unset   | Optional output estimate rate; configure both rates together.                     |
| `AI_OPERATIONAL_RETENTION_DAYS`       | 7       | Private operational payload/trace retention, 1–30 days.                           |

Existing `AI_MAX_TOOL_CALLS`, `AI_TURN_TIMEOUT_MS`, voice queue, idle and session timeouts
still apply. Session lifetime also applies to typed sessions. Quotas count before audio is
forwarded. A time/audio/spend/tool limit aborts local work, closes the provider and returns a
fixed `limit_exceeded` error. Accepted external effects cannot be undone; cancelled writes
keep their conservative executor outcome. No limit automatically repeats an action.

Admission uses a Tenant transaction lock. Device session counts and spend allocations survive
process restarts. Crashed sessions occupy concurrency until their bounded lease expires. All
sessions, including aborted/failed startup, consume their allocation: missing usage never refunds
unknown spending. A session crossing midnight continues charging its admission-day audio counter.
Counters expire only after the operational retention period; deleting a conversation never resets
current-day quotas. Increasing a limit is an explicit owner configuration change.

**An allocation is not an invoice or a guaranteed provider billing cap.** Choose a session
reservation conservatively for the configured time, audio and tool budgets. Optional token rates
produce estimates only; mixed modalities, cached tokens, provider-side work and delayed usage can
make estimates differ from billed cost. Observed usage reaching the reservation stops subsequent
work; usage received after generation cannot prevent money already spent. Use provider-side quota
and billing controls as well. No live prices are embedded. Unknown/missing/incomplete final usage
is labeled `unknown`, never zero. Reported token counts with rates are labeled `estimated`, never
actual cost. Intermediate aggregate usage replaces the prior estimate for that turn instead of
being charged twice. Tokens are only finalized on successful provider turn completion.

## Authenticated operational endpoints

The runtime exposes these server-to-server endpoints with the existing owner access Bearer token.
The token is authenticated against the live owner session and Tenant. Browser-origin requests
are denied; keep the runtime behind the same private/TLS boundary as other console endpoints.
No device credential or request Tenant ID grants access.

- `GET /console/diagnostics?id=<conversation-id>` returns the active policy, provider configuration
  state and a bounded trace. Configuration state is not a successful reachability check; use the
  existing authenticated integration tests to test current HTTP service health.
- `POST /console/privacy` with JSON `{"action":"cleanup"}` clears up to 100 expired conversations
  for the authenticated Tenant; repeat to drain a larger backlog.
- `POST /console/privacy` with JSON `{"action":"delete","conversationId":"<id>"}` clears one
  inactive conversation's private data. `cleared: 0` means absent, already cleared, or still active.
  Stop a live session before deletion. Active dispatch/reconciliation is protected.

The runtime runs bounded Tenant-scoped cleanup every minute while voice services are enabled.
Payload expiry is based on conversation creation time, so a record may remain until the next
cleanup batch. A stopped runtime cannot clean its database; run cleanup after restarting.

A trace links session correlation ID, conversation/turn IDs, execution IDs and device command IDs
with safe statuses/timestamps. Phase elapsed milliseconds are measured from turn start:
input start/commit, provider request/first event, tool start/result, first useful delivered output,
generation and separate playback completion. A provider event or approval/progress indicator is
not useful output. Held model claims before tools are excluded. Missing phases remain absent.
Actual phase differences can be calculated from the elapsed values; no invented latency is returned.
The endpoint never returns tool arguments/results, transcripts, provider exceptions or reasoning.

## Retention boundaries

Raw audio is never persisted. Transcript retention remains off by default; message rows retain
only role/identity/timestamps. Registered-tool arguments, exact approval snapshots and results
can contain note/display content while needed for dispatch integrity. Cleanup/deletion clears
these payloads, transcripts, actor snapshots and trace/usage events, and disables transcript
retention for the affected conversation. It does not delete independent notes already created
in the notes service or revoke device credentials/grants.

Minimal conversation/turn/execution/command identities, hashes and terminal outcomes remain as
safety tombstones so a privacy deletion cannot enable replay of an external write. They are not
full-payload audit history. Unknown writes remain unknown. After private arguments are erased,
a reconciliation requiring those arguments may be unavailable; never recreate an execution to retry
it. Active dispatches/reconciliation must finish or be resolved before their private data is cleared.

Application retention cannot erase data held by the AI/HTTP provider. Review the provider account,
billing mode, logging/sharing settings, and [Gemini API terms](https://ai.google.dev/gemini-api/terms)
before sending data. Google's paid/unpaid data-use rules differ, and paid-service abuse-prevention
logging is separate from application storage. OpenHuli makes no provider zero-retention promise.

## Verification

Disposable PostgreSQL tests cover concurrent admission, reconnect quotas, nonrefundable unknown
usage, safe traces, Tenant isolation, expiry cleanup/deletion and retained write identities.
Runtime tests cover quota cancellation and tool dispatch gating. A live acceptance trace additionally
requires a configured runtime provider key, a real authenticated turn and any relevant HTTP/broker
services. Deterministic provider tests do not establish provider latency, billing or hardware behavior.
