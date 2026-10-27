import appConfig from "./apps/app/vitest.config";
import { defineWorkspace } from "vitest/config";
import { getTestDatabaseUrl } from "./scripts/test-database";

const databaseUrl = getTestDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_DATABASE_URL = databaseUrl;

export default defineWorkspace([
  ...["devices", "conversations", "tool-execution"].map((feature) => ({
    root: `./packages/modules/${feature}`,
    test: {
      name: `${feature}-integration`,
      include: ["src/**/__tests__/**/*.integration.test.ts"],
      exclude: ["node_modules", "dist"],
      env: { DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: databaseUrl },
    },
  })),
  {
    root: "./packages/modules/todos",
    test: {
      name: "todos-integration",
      include: ["src/**/__tests__/**/*.integration.test.ts"],
      exclude: ["node_modules", "dist"],
      env: { DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: databaseUrl },
    },
  },
  {
    resolve: appConfig.resolve,
    root: "./apps/app",
    test: {
      name: "owner-integration",
      include: ["src/**/__tests__/**/*.integration.test.ts"],
      exclude: ["node_modules", "dist"],
      env: {
        DATABASE_URL: databaseUrl,
        DIRECT_DATABASE_URL: databaseUrl,
        JWT_SECRET: "synthetic-unit-secret-at-least-32-characters",
        OWNER_EMAIL: "owner@example.test",
        APP_URL: "http://localhost:3000",
      },
    },
  },
]);
