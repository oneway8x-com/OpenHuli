import { randomUUID } from "node:crypto";
import {
  IntegrationSettingsSchema,
  type IntegrationSettings,
} from "@corely/contracts";
import type { HttpToolsConfig } from "./config";
import { createHttpTools } from "./tools";
import { JsonHttpClient } from "./http-client";
import type { SecretStore } from "./http-operation";

export interface HttpIntegrationStore {
  get(tenantId: string): Promise<unknown>;
  save(tenantId: string, settings: IntegrationSettings): Promise<void>;
}
export async function readIntegrationSettings(
  context: { tenantId: string },
  store: HttpIntegrationStore,
  defaults: HttpToolsConfig,
) {
  const saved = await store.get(context.tenantId);
  return IntegrationSettingsSchema.parse(
    saved ?? {
      weather: defaults.weather ?? null,
      weatherEnabled: Boolean(defaults.weather),
      notesEnabled: Boolean(defaults.notes),
    },
  );
}
export async function saveIntegrationSettings(
  input: unknown,
  context: { tenantId: string },
  store: HttpIntegrationStore,
) {
  const settings = IntegrationSettingsSchema.parse(input);
  await store.save(context.tenantId, settings);
  return settings;
}
export async function tenantHttpConfig(
  context: { tenantId: string },
  store: HttpIntegrationStore,
  defaults: HttpToolsConfig,
): Promise<HttpToolsConfig> {
  const settings = await readIntegrationSettings(context, store, defaults);
  return {
    ...(settings.weatherEnabled && settings.weather
      ? { weather: settings.weather }
      : {}),
    ...(settings.notesEnabled && defaults.notes
      ? { notes: defaults.notes }
      : {}),
  };
}
/** Read-only connection probes: validated forecast GET or authenticated notes health check. */
export async function testHttpIntegration(
  toolId: "weather.forecast" | "notes.create",
  context: { tenantId: string },
  config: HttpToolsConfig,
  secrets: SecretStore,
  client = new JsonHttpClient(),
) {
  const signal = AbortSignal.timeout(6000);
  if (toolId === "weather.forecast") {
    const tool = createHttpTools(config, secrets, client).find(
      (t) => t.id === toolId,
    );
    if (!tool) throw new Error("Forecast is not configured or enabled");
    const result = await tool.execute(
      { days: 1 },
      {
        ...context,
        executionId: randomUUID(),
        targetDeviceId: null,
        idempotencyKey: randomUUID(),
        signal,
      },
    );
    return {
      ok: result.kind === "succeeded",
      message: "Forecast GET returned validated data. No note was created.",
    };
  }
  if (!config.notes) throw new Error("Notes is not configured or enabled");
  const url = new URL(config.notes.destination.url);
  url.pathname = "/health";
  url.search = "";
  const result = await client.send({
    destination: { ...config.notes.destination, url: url.href },
    method: "GET",
    headers: {
      Authorization: `Bearer ${await secrets.get(config.notes.secretReference)}`,
    },
    signal,
    expectedStatus: 200,
  });
  if (result.ready !== true) throw new Error("Notes connection test failed");
  return {
    ok: true,
    message: "Notes authenticated health check succeeded. No note was created.",
  };
}
