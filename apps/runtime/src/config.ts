import { z } from "zod";

const optionalString = (schema: z.ZodString) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );
const timeout = (fallback: number) =>
  z.coerce.number().int().min(100).max(30_000).default(fallback);
const ConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    RUNTIME_HOST: z
      .enum(["127.0.0.1", "::1", "0.0.0.0", "::"])
      .default("127.0.0.1"),
    RUNTIME_PORT: z.coerce.number().int().min(0).max(65535).default(3200),
    RUNTIME_VOICE_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    RUNTIME_VOICE_QUEUE_BYTES: z.coerce
      .number()
      .int()
      .min(664)
      .max(1048576)
      .default(21248),
    RUNTIME_VOICE_QUEUE_MESSAGES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1024)
      .default(64),
    RUNTIME_VOICE_BUFFERED_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(1048576)
      .default(65536),
    RUNTIME_VOICE_OPERATION_TIMEOUT_MS: timeout(5000),
    RUNTIME_VOICE_TURN_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(30000)
      .default(30000),
    RUNTIME_VOICE_SESSION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(3600000)
      .default(600000),
    RUNTIME_PROBE_TOKEN: optionalString(
      z
        .string()
        .min(32)
        .max(256)
        .regex(/^[A-Za-z0-9_-]+$/),
    ),
    RUNTIME_MQTT_URL: optionalString(z.string().url()),
    RUNTIME_MQTT_USERNAME: optionalString(z.string().min(1).max(256)),
    RUNTIME_MQTT_PASSWORD: optionalString(z.string().min(1).max(1024)),
    RUNTIME_STARTUP_TIMEOUT_MS: timeout(5000),
    RUNTIME_SHUTDOWN_TIMEOUT_MS: timeout(5000),
    RUNTIME_IDLE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(300_000)
      .default(30_000),
    RUNTIME_MAX_CONNECTIONS: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(100),
  })
  .superRefine((config, ctx) => {
    const issue = (key: string) =>
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "Invalid runtime setting",
      });
    if (
      Boolean(config.RUNTIME_MQTT_USERNAME) !==
      Boolean(config.RUNTIME_MQTT_PASSWORD)
    )
      issue("RUNTIME_MQTT_USERNAME");
    if (!config.RUNTIME_MQTT_URL && config.RUNTIME_MQTT_USERNAME)
      issue("RUNTIME_MQTT_URL");
    if (config.RUNTIME_MQTT_URL) {
      let url: URL;
      try {
        url = new URL(config.RUNTIME_MQTT_URL);
      } catch {
        issue("RUNTIME_MQTT_URL");
        return;
      }
      if (
        !["mqtt:", "mqtts:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.pathname && url.pathname !== "/")
      )
        issue("RUNTIME_MQTT_URL");
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (
        url.protocol !== "mqtts:" &&
        (config.NODE_ENV === "production" || !local)
      )
        issue("RUNTIME_MQTT_URL");
    }
  });

export class RuntimeConfigurationError extends Error {}
export type RuntimeConfig = z.infer<typeof ConfigSchema>;

export function readRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const result = ConfigSchema.safeParse(env);
  if (env.RUNTIME_VOICE_ENABLED === "true") {
    try {
      const url = new URL(env.DATABASE_URL || "");
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !url.hostname ||
        url.pathname.length < 2 ||
        url.hash
      )
        throw new Error();
    } catch {
      throw new RuntimeConfigurationError(
        "Invalid runtime configuration: DATABASE_URL",
      );
    }
  }
  if (!result.success) {
    const keys = [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ];
    // Never include received values, broker URLs, tokens, or passwords in diagnostics.
    throw new RuntimeConfigurationError(
      `Invalid runtime configuration: ${keys.join(", ")}`,
    );
  }
  return result.data;
}
