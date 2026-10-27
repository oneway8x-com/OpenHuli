# OpenHuli boundaries

- Next pages/UI call feature APIs; synchronous route handlers validate/serialize and call explicit
  use cases through server composition. Routes and AI tools do not implement business policy inline.
- Feature logic lives in `packages/modules/*`, stays framework-free, and uses the public contracts,
  ports, or use cases of other features rather than their private persistence.
- Keep simple features flat like `todos`. Separate layers only when the problem requires them.
- Prisma imports and queries belong in repositories or persistence setup, never UI or routes.
  Contracts expose DTOs, not generated Prisma types.
- Shared UI must not depend on app feature modules. Avoid deep imports between feature modules.
- Use Tenant and preserve its scope through lookups, mutations, retries, and failures. Device/model
  input never establishes authority. No new Platform, Workspace, or generic Automation domains.
- Persistent voice/MQTT transport belongs in the planned Node runtime; reusable execution policy
  stays in shared feature use cases, not duplicated between Next routes and device transports.

`pnpm arch:check` checks selected import boundaries. It is not proof of authorization, complete
persistence isolation, or all architecture rules; review the request flow and test behavior too.
[AGENTS.md](../../AGENTS.md) owns repository working rules; [architecture](architect.md) describes runtime ownership.
