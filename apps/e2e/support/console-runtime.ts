import { ToolRegistry } from "../../../packages/modules/tool-execution/src/index";
import { createConsoleHttpFixture } from "../../runtime/src/__tests__/console-http-fixture";
// Private browser-test host: real auth, runtime, executor and database; synthetic provider/effect only.
import { readRuntimeConfig } from "../../runtime/src/config";
import { createRuntime } from "../../runtime/src/runtime";
import { createConsoleRuntime } from "../../runtime/src/console";
import { createConsoleFixture } from "../../runtime/src/__tests__/console-fixture";
import { getTestDatabaseUrl } from "../../../scripts/test-database";
const database = getTestDatabaseUrl();
if (
  process.env.DATABASE_URL !== database ||
  process.env.DIRECT_DATABASE_URL !== database
)
  throw new Error("Unsafe console test database");
const config = readRuntimeConfig({
  ...process.env,
  NODE_ENV: "test",
  RUNTIME_PORT: "3218",
  RUNTIME_HOST: "127.0.0.1",
  AI_TURN_TIMEOUT_MS: "30000",
});
const fixture = createConsoleFixture(config);
const httpFixture = await createConsoleHttpFixture(config);
const host = createRuntime(config, {
  console: createConsoleRuntime(
    {
      ...fixture.composition,
      async openOwner(context, token) {
        const device = await fixture.composition.tools.devices.findDevice(
          context.tenantId,
          context.deviceId,
        );
        return device?.name === "HTTP console device"
          ? httpFixture.composition.openOwner(context, token)
          : fixture.composition.openOwner(context, token);
      },
      tools: {
        ...fixture.composition.tools,
        registry: new ToolRegistry([
          fixture.composition.tools.registry.get("device_context"),
          httpFixture.composition.tools.registry.get("weather.forecast"),
          httpFixture.composition.tools.registry.get("notes.create"),
        ]),
      },
    },
    true,
  ),
});
await host.start();
const stop = () => {
  void host
    .stop()
    .then(async () => {
      await fixture.composition.close();
      await httpFixture.close();
    })
    .then(() => process.exit(0));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
