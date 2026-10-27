# Authorized tool execution

Issue [#8](https://github.com/oneway8x-com/OpenHuli/issues/8) provides the shared executor in
`packages/modules/tool-execution`. Transport adapters, future conversation orchestration, and
console actions call these use cases rather than invoking tool callbacks or mutating execution rows.
This module adds no transport endpoint, arbitrary HTTP destination, or live provider integration.
Registered HTTP tools are tracked in #11; voice and console adapters are separate MVP tasks.

## Registration and authority

Construct a server-owned `ToolRegistry` from `defineTool` definitions. Each definition declares:

- An immutable ID and revision, read/write effect, tenant/device resource scope, and risk.
- Argument/output Zod schemas and an exact target resolver for device resources.
- A timeout (10–30,000 ms), at most three read attempts, and exactly one write dispatch attempt.
- Approval policy and a typed executor callback. High-risk tools require per-execution approval.
- An optional **query-only** reconciliation callback that looks up an existing provider outcome.

Definitions are code, never device/model input. Their callbacks invoke feature use cases or typed
external ports. A callback receives the authenticated Tenant, execution ID, exact target, AbortSignal,
and stable provider idempotency key. It must pass that Tenant through all downstream use cases and
honor cancellation/timeouts. Mark an effect as a write whenever it can mutate external or local state.
Never hide writes inside read callbacks to gain retries. Schemas/resolvers must be deterministic.
Bump the revision when a schema, target resolver, executor, or destination changes; the revision and
policy metadata form the immutable policy hash. An old approval/preauthorization cannot grant a new
policy. Duplicate registration and unregistered calls fail closed.

`ToolAuthentication` accepts an owner access token or a purpose-scoped voice device token. Existing
identity/device use cases verify signatures/digests, live sessions, membership, tenant/device state,
credential purpose, expiry, and revocation. The ledger stores only the resulting actor identifiers and
original access expiry, never the authentication token. Device source IDs must match the conversation's
bound device. Its current tool grant must allow the exact resolved target; model arguments do not
grant permission. An owner can view/manage executions only in the authenticated Tenant. A device can
view/manage only executions originating from that same device.

## Request, consent, dispatch

1. `submitToolCall({toolCall, correlationId}, authentication, dependencies)` validates the registered
   schema, authenticates the source, checks grants/resource scope and active committed turn, and
   atomically reserves the existing ToolExecution identity plus an approval if required. The server
   chooses the execution/approval IDs and a deadline no later than five minutes or conversation expiry.
2. `getToolExecution` returns the persisted view. Repeated provider events use the same conversation
   and tool-call IDs; canonical argument key ordering does not change identity. A different actor,
   argument, target, turn, or registered policy under that identity is rejected. A valid duplicate
   can return its existing terminal result after the turn completes, without dispatching again.
3. `decideToolApproval` requires a currently authenticated owner and the version 1 approval decision
   envelope plus `requestHash` and explicit `targetDeviceId` (null for tenant resources). Display the
   stored exact arguments/target with this identity when building the approval UI. A decision checks
   the original live session, turn, current device grant, exact hash/arguments/target, expiry, and
   execution ID. A conditional transaction allows one decision; rejection cancels the execution.
4. `dispatchToolExecution` rechecks live authority, original session, registered policy and consent,
   then conditionally moves queued → running before invoking a callback. Only one concurrent caller
   can claim dispatch. Approval does not replace a device grant. A revoked preauthorization or grant,
   cancelled turn, expired source session, or changed policy prevents the effect.

Reads with `approval: "never"` need no consent beyond authenticated resource authorization. Writes
always need owner consent: `preauthorizeTool` explicitly grants a registered **low-risk** write with
`approval: "never"` for one source device (or owner source), target, policy revision, and at most 30 days.
It does not widen device grants. Other writes require per-execution approval; high-risk actions cannot
be preauthorized. `revokeToolPreauthorization` affects future dispatch, and current owner membership is
checked when consuming consent. `ToolPreauthorization` is permission data, not another execution ledger.

## Outcomes, cancellation, restart

- Successful callbacks return `succeeded` with schema-validated output. Definitive failure returns
  `failed`. Partial completion returns `partial` and the confirmed output: the persisted execution
  status is `failed` with `outcome: "partial"`, so a client cannot mistake partial work for full success.
- A thrown exception, rejected output, or timeout after invoking a write leaves `unknown`; it does
  not prove that the provider rejected the action. Error views use fixed safe messages, not raw
  provider errors. Failed reads can retry only up to their registered limit with fresh authorization.
- An AbortSignal prevents undispatched work and is forwarded to the callback. `cancelToolExecution`
  cancels queued/waiting work. A running read becomes cancelled; a running write becomes unknown.
  A late callback cannot overwrite that state. Cross-process cancellation records intent; adapters
  must also abort local network/provider work. Effects already accepted externally cannot be undone.
- A process crash leaves its durable reservation in running state. Once its dispatch deadline passes,
  `reconcileToolExecution` marks it unknown, never queued. It can then run the registered **query-only**
  provider lookup using the original stable idempotency key and a bounded reconciliation lease.
  A confirmed outcome resolves the ledger; unavailable/ambiguous provider results remain unknown.
  Current owner authority may reconcile an old expired source session because this queries an outcome
  and does not perform the original effect. Device requesters still need their current exact grant.

The stable provider idempotency key is `openhuli:<tenantId>:<executionId>`. Provider adapters must use
supported idempotency semantics and keep the key attached to that exact effect. There is no universal
exactly-once guarantee across arbitrary remote systems. Never change tool-call/execution identity to
retry an uncertain write. Without a provider reconciliation capability, leave the outcome unknown
for explicit operator investigation. A provider ignoring AbortSignal can still finish later; the
ledger remains conservative and no repeated execution is allowed.

The older conversation persistence mutation helpers reject executor-managed records. New adapters
must use this executor rather than the storage-only `claimToolExecution`/transition helpers. Existing
non-managed legacy records remain compatible and are not promoted into authorized executable work.

## Verification and retention

The additive transactional migration extends ToolExecution/ExecutionApproval and adds expiring owner
consent with tenant-safe target/source relationships. No existing execution or transcript is removed.
The existing migration check now upgrades fresh and seeded schemas through this migration. Run
`pnpm test:migrations` and `pnpm test:int` with an explicit disposable local `TEST_DATABASE_URL` after
`pnpm test:db:setup`. Unit tests validate the registry; PostgreSQL tests exercise concurrent delivery,
restart deduplication, exact approval replay, cross-tenant access, revoked grants/preauthorization,
partial completion, cancellation, and remote-acceptance-before-timeout reconciliation.

Arguments/approval snapshots, safe output, actor IDs, hashes, status, and timestamps are operational
records needed to explain an external effect. They can contain user data even with transcript
retention off; tool schemas and provider adapters must bound/redact sensitive fields. Neither authentication
tokens nor raw provider exceptions are persisted. Retention cleanup and adapter/network integration
remain separate tasks; passing deterministic fake-provider checks does not establish live provider or
hardware behavior.
