import { readRuntimeConfig, RuntimeConfigurationError } from "./config";
import { createMqttDependency } from "./mqtt";
import { createRuntime } from "./runtime";

async function main(): Promise<void> {
  let config;
  try {
    config = readRuntimeConfig(process.env);
  } catch (error) {
    console.error(
      error instanceof RuntimeConfigurationError
        ? error.message
        : "Invalid runtime configuration",
    );
    process.exitCode = 1;
    return;
  }
  const services = config.RUNTIME_MQTT_TELEMETRY_ENABLED
    ? (await import("./telemetry-services")).createTelemetryServices(config)
    : undefined;
  const telemetryMqtt = services
    ? (await import("./mqtt-telemetry")).createTelemetryMqttDependency(
        config,
        services,
      )
    : undefined;
  if (services && telemetryMqtt) services.commands.publisher = telemetryMqtt;
  const mqtt =
    telemetryMqtt ??
    (config.RUNTIME_MQTT_URL ? createMqttDependency(config) : undefined);
  const conversation = config.RUNTIME_VOICE_ENABLED
    ? (
        await import("./conversation-composition")
      ).createLiveConversationRuntime(config, undefined, services?.commands)
    : undefined;
  const authorization = config.RUNTIME_VOICE_ENABLED
    ? (await import("./device-authorization")).createVoiceAuthorization()
    : undefined;
  const voice = authorization
    ? {
        authorization: {
          ...authorization,
          async close() {
            await authorization.close();
          },
        },
        ...(conversation ? { provider: conversation } : {}),
      }
    : undefined;
  const consoleRuntime = conversation
    ? (await import("./console")).createConsoleRuntime(
        conversation,
        Boolean(config.GEMINI_API_KEY),
      )
    : undefined;
  const management = conversation
    ? (await import("./management")).createDeviceManagement(
        conversation,
        services?.telemetry,
      )
    : undefined;
  const runtime = createRuntime(config, {
    ...(management ? { management } : {}),
    ...(consoleRuntime ? { console: consoleRuntime } : {}),
    ...(voice ? { voice } : {}),
    dependencies: mqtt ? [mqtt] : [],
  });
  let stopping = false;
  const shutdown = () => {
    stopping = true;
    void runtime
      .stop()
      .then(async () => {
        await conversation?.close();
        process.off("SIGTERM", shutdown);
        process.off("SIGINT", shutdown);
      })
      .catch(() => {
        console.error("Runtime shutdown failed");
        // Deadline exceeded: a broken adapter may still hold native handles. Do not orphan the process.
        process.exit(1);
      });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  try {
    const address = await runtime.start();
    console.info(
      JSON.stringify({
        event: "runtime.started",
        host: address.address,
        port: address.port,
      }),
    );
  } catch {
    if (!stopping) {
      await conversation?.close();
      console.error("Runtime startup failed");
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
      process.exitCode = 1;
      if (runtime.health().phase === "failed") process.exit(1);
    }
  }
}

void main();
