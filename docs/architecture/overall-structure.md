# OpenHuli repository structure

- `apps/app/app`: Next.js pages/layouts and thin API routes.
- `apps/app/src/modules`: feature UI; `src/server`: HTTP composition and persistence setup.
- `packages/modules/todos/src`: `todo.schemas.ts`, `todo.types.ts`, `todo.repository.ts`,
  `todo.errors.ts`, `use-cases/*`, and `__tests__/*`. This is the simple-feature reference.
- `packages/contracts`: shared schemas and DTOs.
- `packages/data/prisma/schema.prisma`: canonical PostgreSQL schema; sibling `migrations/` holds
  committed migrations. `packages/data/src/prisma` holds persistence utilities.
- `packages/ui`: reusable UI; `packages/kernel`: shared ports/primitives.
- `apps/e2e`: Playwright configuration, isolated data fixtures, and browser journeys.
- `scripts`: check/setup utilities; `.github/workflows`: CI; `tasks`: short implementation diaries.

The persistent WSS/MQTT runtime and firmware are planned MVP work, not existing directories.
The pnpm workspace and package scopes retain their scaffold names. See [architecture](architect.md)
and [the MVP specification](../mvp-spec.md) for current versus intended runtime behavior.
