import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/*/vitest.config.ts",
  "packages/modules/*/vitest.config.ts",
  "apps/app/vitest.config.ts",
  "apps/runtime/vitest.config.ts",
  "apps/notes-api/vitest.config.ts",
]);
