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
  const runtime = createRuntime(config, {
    dependencies: config.RUNTIME_MQTT_URL ? [createMqttDependency(config)] : [],
  });
  let stopping = false;
  const shutdown = () => {
    stopping = true;
    void runtime
      .stop()
      .then(() => {
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
      console.error("Runtime startup failed");
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
      process.exitCode = 1;
      if (runtime.health().phase === "failed") process.exit(1);
    }
  }
}

void main();
