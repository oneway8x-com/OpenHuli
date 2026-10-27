import { spawnSync } from "node:child_process";
import { getTestDatabaseUrl } from "./test-database.ts";

const databaseUrl = getTestDatabaseUrl();
console.log(
  "Applying committed migrations to the disposable local openhuli_test database.",
);
const result = spawnSync(
  "pnpm",
  ["--filter", "@corely/data", "exec", "prisma", "migrate", "deploy"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      DIRECT_DATABASE_URL: databaseUrl,
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
