import { PrismaService } from "@corely/data";
import { createTelemetryServices } from "../../runtime/src/telemetry-services";
import { createDeviceManagement } from "../../runtime/src/management";
import { ingestDeviceCommandResult } from "../../../packages/modules/device-commands/src/index";
import { deviceMqttIdentity } from "../../../packages/modules/devices/src/index";
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
const db = new PrismaService();
const deviceTenant = (id: string) =>
  db.device.findUnique({ where: { id }, select: { tenantId: true } });
const services = createTelemetryServices(config);
services.telemetry.epoch = "a5e7e480-7d99-4e84-ae48-02b939097819";
services.commands.publisher = {
  isReady: () => true,
  async publishCommand(command) {
    const device = await deviceTenant(command.deviceId);
    if (!device) throw new Error("Unknown synthetic target");
    if (
      command.action.kind === "display.write" &&
      command.action.text === "simulate unknown"
    )
      return "accepted";
    const credential = (
      await services.telemetry.devices.credentials(
        device.tenantId,
        command.deviceId,
      )
    ).find((c) => c.purpose === "mqtt" && !c.revokedAt);
    if (!credential) return "not_sent";
    await ingestDeviceCommandResult(
      {
        identity: deviceMqttIdentity({
          tenantId: device.tenantId,
          deviceId: command.deviceId,
          credentialId: credential.id,
        }),
        topic: `openhuli/v1/devices/${command.deviceId}/results`,
        retained: false,
        payload: JSON.stringify({
          version: 1,
          type: "device.command.result",
          messageId: command.commandId,
          commandId: command.commandId,
          executionId: command.executionId,
          deviceId: command.deviceId,
          status: "succeeded",
          completedAt: new Date().toISOString(),
        }),
      },
      services.commands,
    );
    return "accepted";
  },
};
const httpFixture = await createConsoleHttpFixture(config, services.commands);
const host = createRuntime(config, {
  management: createDeviceManagement(
    httpFixture.composition,
    services.telemetry,
  ),
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
      async registryForTenant(tenantId) {
        const local = await fixture.composition.registryForTenant(tenantId);
        const http = await httpFixture.composition.registryForTenant(tenantId);
        return new ToolRegistry([
          local.get("device_context"),
          http.get("weather.forecast"),
          http.get("notes.create"),
        ]);
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
      await services.close();
      await db.disconnect();
    })
    .then(() => process.exit(0));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
