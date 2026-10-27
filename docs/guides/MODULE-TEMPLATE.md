# Simple feature reference

Use `packages/modules/todos` as the working reference instead of generating a layer hierarchy:

```text
src/
  feature.types.ts
  feature.schemas.ts
  feature.errors.ts
  feature.repository.ts
  use-cases/
  __tests__/
  index.ts
```

Keep explicit use cases, a repository for persistence, and ports only for external/volatile
boundaries. Add shared wire schemas under `packages/contracts` and compose the module from
`apps/app/src/server`; thin Next routes call use cases. UI belongs in the app's matching feature
module. Every resource lookup/write needs Tenant scope and relevant authorization.

Follow [AGENTS.md](../../AGENTS.md) and [boundaries](../architecture/BOUNDARIES.md). Do not add full
DDD layering for CRUD or copy unused scaffold domains into a new feature.
