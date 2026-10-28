import { defineWorkspace } from "vitest/config";
import { getTestDatabaseUrl } from "./scripts/test-database";
import runtime from "./apps/runtime/vitest.config";
const databaseUrl = getTestDatabaseUrl();
if (!process.env.TEST_MQTT_BROKER_IMAGE)
  throw new Error(
    "TEST_MQTT_BROKER_IMAGE must name the locally built OpenHuli Mosquitto image; see MQTT_TELEMETRY.md",
  );
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_DATABASE_URL = databaseUrl;
export default defineWorkspace([
  {
    root: "./apps/runtime",
    resolve: runtime.resolve,
    test: {
      name: "mqtt-broker",
      include: ["src/**/__tests__/**/*.broker.test.ts"],
      hookTimeout: 30000,
      testTimeout: 15000,
      env: { DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: databaseUrl },
    },
  },
]);
