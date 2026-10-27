import { defineWorkspace } from "vitest/config";
import { getTestDatabaseUrl } from "./scripts/test-database";

const databaseUrl = getTestDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_DATABASE_URL = databaseUrl;

export default defineWorkspace([
  {
    root: "./packages/modules/todos",
    test: {
      name: "todos-integration",
      include: ["src/**/__tests__/**/*.integration.test.ts"],
      exclude: ["node_modules", "dist"],
      env: { DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: databaseUrl },
    },
  },
]);
