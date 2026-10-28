# Device and conversation persistence

Issue [#6](https://github.com/oneway8x-com/OpenHuli/issues/6) adds storage foundations for the
version 1 contracts. It does not add pairing endpoints, a tool dispatcher, MQTT delivery, or a
voice server. Those callers must use the feature use cases and supply authenticated server context.
A device payload, AI output, or capability manifest cannot grant tenant authority or tool access.

## Ownership and mapping

- `packages/modules/devices`: profiles, hashed credentials, expiring/revocable tool grants,
  deduplicated telemetry, commands, and first-result acknowledgement persistence.
- `packages/modules/conversations`: conversation/turn metadata, optional text messages, durable
  execution claims, exact-argument approvals, and deduplicated usage events.
- `AgentRun` remains the conversation, `Message` remains its message store, and `ToolExecution`
  remains the only tool execution ledger. `ConversationTurn` records text/voice turn state and
  distinct generation/playback completion times. It is not another execution ledger.
- Existing `IntegrationConnection`, `AuditLog`, and `IdempotencyKey` remain available for their
  original purposes. Per-turn usage events are separate from aggregate billing counters.

Repositories own Prisma access. Public use cases validate unknown input using existing wire schemas
or feature-local schemas. They receive tenant context separately; console and device adapters must
authenticate and authorize that context before invoking them. Device telemetry and results additionally
require the authenticated device ID and reject a differing payload ID. Device grant storage does not
itself implement the future registered-tool authorization policy.

All reads and updates include tenant IDs. Composite foreign keys also reject cross-tenant parent
references and prevent attaching a message, execution, or usage event to another conversation's turn.
A telemetry sequence uses PostgreSQL bigint to preserve the protocol's full uint32 range. History
queries are bounded to at most 100 records per call.

## Retry and outcome rules

`claimToolExecution` inserts the existing unique `(tenantId, runId, toolCallId)` identity atomically.
Exactly one concurrent delivery gets `claimed: true`; all later deliveries get the persisted ledger
entry with `claimed: false`. Reusing the identity with different tool/turn/arguments is an error.
Callers must inspect persisted state and must never dispatch again merely because a process restarted.
An execution moves to `running` with a conditional update; cancelled turns and expired conversations
or executions cannot start. Terminal states, including `unknown`, cannot return to `running`.
This is a reservation/ledger primitive, not a guarantee that an external write happened exactly once.

Approval creation binds the exact stored tool/turn/argument snapshot and moves the execution to
`awaiting_approval` in one transaction. A single conditional decision records the authenticated owner
and either requeues the approved execution, cancels a rejection, or expires a late decision. The
approval deadline cannot exceed execution expiry. A transport should return an already stored
approval after an uncertain create response rather than create a second approval.

Telemetry is deduplicated by both message identity and `(device, boot, sequence)`; original samples
are not overwritten. Commands are unique per execution and retain their full payload and deadline.
Only a running execution bound to the same device can create a command. An expired or already resolved
command cannot be revived by a duplicate or late acknowledgement. Expiry is conservative: it does not
prove whether physical work happened. Callers can read the stored command after an uncertain enqueue
response and must not create another command with a new execution identity to repeat an uncertain write.
Usage event identity is unique per conversation; duplicate events never add quantity twice.

## Retention and credentials

New conversations default to `retainTranscripts: false`. Appending a message in that mode stores role,
IDs, and timestamps with `contentText = null` and `partsJson = "[]"`, even when input includes text.
Explicit server-authorized retention stores bounded text in those existing message columns. There
is no raw audio field or raw audio persistence use case. Generation/playback timestamps store metadata.
Tool arguments and approval snapshots are intentionally retained for execution integrity and can contain
user data; callers must apply registered schemas and redaction policy before persistence. Transcript
retention is not a promise to remove all operational data. Bounded cleanup and deletion controls are implemented by [session operations](../guides/SESSION_OPERATIONS.md);
minimal execution identities remain to prevent replay.

Credential persistence accepts only SHA-256 hex digests of server-generated high-entropy secrets.
Pairing/transport code must hash secrets before calling it, keep plaintext out of logs, and authenticate
credentials using the trusted tenant context. Reads check credential expiry/revocation and device status;
grant reads similarly check expiry/revocation. Revocation changes only rows in the authenticated tenant.

## Migration and checks

The additive migration preserves existing run/message/execution rows, allows their new optional fields
to remain null, and defaults transcript retention off for future writes. Historical transcripts are not
deleted. It replaces single-column run foreign keys with tenant-safe composite keys. Existing rows with
inconsistent run/tenant ownership cause the transaction to fail without partial changes; inspect and
repair such data explicitly before upgrading. No table or existing content column is dropped.

Run from the repository root after installing dependencies and generating Prisma:

```sh
pnpm prisma:generate
pnpm prisma:validate
# TEST_DATABASE_URL must select the disposable local openhuli_test database.
pnpm test:db:setup
pnpm test:migrations
pnpm test:int
```

`test:migrations` applies the baseline and upgrade in isolated temporary schemas for both fresh and
seeded cases, verifies legacy content and unknown execution outcomes, and removes only those schemas.
`test:db:setup` exercises Prisma migration deployment. Integration tests exercise actual PostgreSQL
constraints, concurrent execution/telemetry/usage identities, approval races, expiry, transcript policy,
and cross-tenant reads and mutations. CI runs these checks against its disposable PostgreSQL service.
