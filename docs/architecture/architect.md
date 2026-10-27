# OpenHuli architecture

The current application is a Next.js modular monolith backed by PostgreSQL/Prisma. The
[MVP specification](../mvp-spec.md) adds one persistent Node process for device voice, MQTT, and
AI orchestration. The host foundation is implemented in `apps/runtime`: health/readiness, a protected lifecycle probe,
optional MQTT connection management, and cancellation/cleanup ports. Device audio, conversation
execution, and telemetry processing remain in their feature tickets. See the
[runtime guide](../guides/PERSISTENT_RUNTIME.md).

## Request flow

Today: browser → `apps/app/app/api/todos` → server composition → explicit todo use case →
`TodoRepository` → Prisma/PostgreSQL. Shared Zod contracts validate HTTP input and define DTOs.
Keep Next.js and React out of the feature package. Use the flat todo feature structure as a
reference, not speculative domain/application/infrastructure folders for trivial CRUD.

Planned: authenticated device WSS or console text → persistent conversation runtime → shared
registered-tool executor/use cases → provider/HTTP/MQTT adapter → persisted result → originating
client. Routes and tool handlers must never bypass authorization or use cases. MQTT telemetry
feeds bounded, tenant-scoped persistence; device acknowledgements determine command outcomes.

## Runtime ownership

- Next.js owns console rendering and synchronous HTTP handlers. It can be hosted locally or on
  an appropriate Next.js host; deploying the console alone does not deliver the device product.
- The persistent Node runtime owns WSS sessions, MQTT connections, provider sessions, cancellation,
  and graceful shutdown. It needs always-on hosting, not serverless request lifetimes.
- PostgreSQL owns durable records; Prisma is restricted to repositories/persistence code.
- The [v1 device and voice protocol](../protocol/openhuli-v1.md) defines shared bounded parsers,
  binary audio framing, and connection-local wire validation for the planned runtime and simulator.
- Shared contracts and feature use cases are reused across transports. Keep external/provider
  boundaries behind ports; do not add a service or abstraction for every feature.

## Authority and current limits

Tenant is the sole isolation term. The identity feature verifies owner sessions and live active
OWNER membership. Todo routes and the dashboard derive Tenant scope from that session; headers
cannot establish authority. Bootstrap is an explicit operator CLI. Browser writes require the
configured origin, and production validates secrets and email configuration on startup.
Device authentication remains pending. See [security](../guides/SECURITY.md).

The original scaffold includes unused domain/schema material. Its presence does not activate a
feature or justify extending Platform, Workspace, or generic Automation domains. Keep changes scoped.

## Licensing

OpenHuli uses MIT, selected by the maintainer. `LICENSE` preserves the Corely AI attribution and
package metadata is aligned. Dependency licenses remain independent.

See [structure](overall-structure.md), [boundaries](BOUNDARIES.md), and [AGENTS.md](../../AGENTS.md).
