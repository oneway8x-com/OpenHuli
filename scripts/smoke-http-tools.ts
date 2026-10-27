import { randomUUID } from "node:crypto";
import {
  createHttpToolRegistry,
  readHttpToolsConfig,
  type SecretStore,
} from "../packages/modules/http-tools/src/index.ts";
const mode = process.argv[2] ?? "weather";
const secrets: SecretStore = {
  get: async (reference) => {
    if (reference !== "notes-demo" || !process.env.NOTES_API_TOKEN)
      throw new Error("Secret unavailable");
    return process.env.NOTES_API_TOKEN;
  },
};
const config = readHttpToolsConfig(
  mode === "weather"
    ? {
        ...process.env,
        HTTP_WEATHER_LATITUDE: process.env.HTTP_WEATHER_LATITUDE || "52.52",
        HTTP_WEATHER_LONGITUDE: process.env.HTTP_WEATHER_LONGITUDE || "13.41",
        HTTP_WEATHER_TIMEZONE:
          process.env.HTTP_WEATHER_TIMEZONE || "Europe/Berlin",
      }
    : process.env,
);
const registry = createHttpToolRegistry(config, secrets);
const context = {
  tenantId: "demo-tenant",
  executionId: randomUUID(),
  idempotencyKey: `openhuli:demo-tenant:${randomUUID()}`,
  targetDeviceId: null,
  signal: AbortSignal.timeout(10000),
};
try {
  if (mode === "weather") {
    const result = await registry
      .get("weather.forecast")
      .execute({ days: 1 }, context);
    console.log(
      JSON.stringify({
        mode: "live-adapter-smoke",
        tool: "weather.forecast",
        result,
      }),
    );
  } else if (mode === "notes") {
    const tool = registry.get("notes.create");
    const first = await tool.execute(
      { text: "OpenHuli synthetic live notes smoke" },
      context,
    );
    const repeated = await tool.execute(
      { text: "OpenHuli synthetic live notes smoke" },
      context,
    );
    if (
      first.kind !== "succeeded" ||
      repeated.kind !== "succeeded" ||
      first.output.id !== repeated.output.id
    )
      throw new Error("Idempotency check failed");
    console.log(
      JSON.stringify({
        mode: "live-adapter-smoke",
        tool: "notes.create",
        persistedNoteId: first.output.id,
        duplicateReturnsSameNote: true,
      }),
    );
  } else throw new Error("Choose weather or notes");
} catch {
  console.error("HTTP adapter live smoke failed; no live success established");
  process.exitCode = 1;
}
