# OpenHuli AI-native MVP

## Scope and source

The [21-ticket MVP backlog](https://github.com/oneway8x-com/OpenHuli/issues/1) is the delivery scope.
This document consolidates that backlog using the OpenHuli name and existing repository architecture.
It supersedes the earlier DeviceOps proposal's SQLite/Vite rewrite and voice-later sequence; it does
not claim that planned capabilities already exist. License: MIT, selected by the maintainer, with
original attribution preserved in `LICENSE`.

## Intended experience

A maker pairs an ESP32 device, presses a button, and streams microphone audio while speaking.
The cloud runtime interprets the committed turn, runs only registered authorized tools, and returns
truthful text or streamed audio. The first demonstrations are a live forecast GET, a persisted notes
POST, a real temperature/humidity reading, and an acknowledged display command where supported.
Text input in the console uses the same conversation and execution use cases as device voice.

AI is required for these first-release journeys. Sensor sampling and supported local display behavior
must continue when AI or the network is unavailable. A microphone-equipped reference device is
required for the voice release gate; speakers and displays remain explicit optional capabilities.
Do not claim support for an untested hardware configuration.

## Architecture decisions

- Retain Next.js and the current React console; keep synchronous API handlers thin.
- Retain PostgreSQL and Prisma, extending existing AgentRun, Message, ToolExecution,
  IntegrationConnection, AuditLog, and IdempotencyKey records where appropriate.
- Add one persistent Node runtime for WSS, MQTT, and conversation orchestration. Long-lived
  connections must not run inside Vercel serverless route handlers.
- Keep business rules in feature-owned explicit use cases; routes, UI, voice, and AI tools use them.
- Use shared versioned contracts and external/provider ports. Keep simple features close together;
  do not add microservices per feature or full DDD layering for CRUD.
- One owner is the initial user experience; Tenant remains the internal isolation boundary.

## Delivery sequence

1. Foundation: reproducible checks, authenticated owner/tenant context, contracts, persistent
   runtime, device/conversation persistence, pairing, and authorized execution.
2. Live vertical slice: authenticated paced audio, one streaming AI adapter, registered HTTP
   tools, and a simulator proving voice → real API → response.
3. Hardware: MQTT telemetry/history, acknowledged commands, ESP32 push-to-talk firmware,
   DHT11 sampling, optional display, and streamed output/cancellation.
4. Console and operations: text conversation, approvals/activity, onboarding, telemetry,
   integration management, budgets/privacy/diagnostics, and local/cloud deployment.
5. Release gate: repeatable deterministic tests, live evaluation, physical hardware checks,
   measured latency, exact wiring, and maker setup documentation.

Dependencies and acceptance criteria stay in the linked issues. Complete and validate one useful
slice before moving to the next; foundational work must not claim later integrations are finished.

## Security and execution invariants

- Derive Tenant and owner authority from verified sessions and membership, not caller headers.
- Give devices scoped revocable credentials; provider/API secrets stay on the server.
- Validate capability claims, bounded messages, and protocol versions. Start with half-duplex
  push-to-talk; a disconnected or uncommitted turn must not dispatch tools.
- Register fixed HTTP destinations, methods, argument/output schemas, grants, and approval rules.
  Model output cannot change URLs or grant permission. Reject unapproved redirects and SSRF targets.
- Persist execution identity and exact approved arguments. Deduplicate delivery across restarts;
  uncertain writes remain unknown and are reconciled rather than blindly repeated.
- MQTT publish acceptance is not device success. Commands expire and need execution acknowledgements;
  firmware must reject unsupported capabilities and suppress duplicates within documented limits.
- Keep raw audio and transcript retention off by default. Persist bounded redacted operational
  metadata, enforce session/tool/spend limits, and support retention cleanup.
- Keep cloud TLS verification and broker ACLs explicit; do not expose database/admin surfaces by default.

## Verification and non-goals

Routine CI uses deterministic provider fakes, synthetic data, and a disposable local PostgreSQL
service. Paid/live-provider and physical-device acceptance are separate opt-in runs. The release
needs a real ESP32 microphone → live forecast/notes action, acknowledged display behavior on supported
hardware, 20 consecutive turns, and a one-hour mixed run. Measure p50/p95 phase latency rather than
claiming aspirational response targets as guarantees.

Wake words, full-duplex listening, OTA, robot motion, generic automation/workflow domains, hosted
billing, native apps, and a wholesale scaffold rewrite are outside this MVP. The current foundation
does not satisfy the later hardware or deployment gates.
