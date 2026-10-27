# Streaming

Bounded HTTP/SSE responses may use Next.js route handlers under `apps/app/app/api/*`. Persistent
WebSocket voice sessions, broker connections, and provider lifecycles belong in `apps/runtime`, not
serverless handlers. See the [runtime guide](../guides/PERSISTENT_RUNTIME.md).

## Rules

- keep transport concerns in the route handler
- keep orchestration and tool logic in shared module packages or server helpers
- do not couple streaming handlers to page component state

## Current status

Streaming is part of the target architecture, but the current extracted module slice (`todos`) does not use SSE yet.
