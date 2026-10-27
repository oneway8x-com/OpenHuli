import { createHash } from "node:crypto";
import { z } from "zod";
import { OpenHuliIdSchema } from "@corely/contracts";
import {
  defineTool,
  ToolRegistry,
  type RegisteredTool,
  type ToolContext,
} from "@corely/modules-tool-execution";
import { HttpToolError, type JsonHttpClient } from "./http-client";
import { jsonOperation, type SecretStore } from "./http-operation";
import type { HttpToolsConfig } from "./config";
const revision = (policy: unknown) =>
  "http-v1-" +
  createHash("sha256")
    .update(JSON.stringify(policy))
    .digest("hex")
    .slice(0, 32);
const Empty = z.object({}).strict();
const ForecastInput = z
  .object({ days: z.number().int().min(1).max(3).default(1) })
  .strict();
const Day = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    minimum: z.number().finite(),
    maximum: z.number().finite(),
    precipitationProbability: z.number().min(0).max(100),
  })
  .strict();
const Forecast = z
  .object({
    kind: z.literal("forecast"),
    source: z.literal("Open-Meteo"),
    attribution: z.literal("Weather data by Open-Meteo.com"),
    sourceUrl: z.literal("https://open-meteo.com/"),
    license: z.literal("https://creativecommons.org/licenses/by/4.0/"),
    fetchedAt: z.string().datetime(),
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.string(),
    temperatureUnit: z.enum(["celsius", "fahrenheit"]),
    days: z.array(Day).min(1).max(3),
  })
  .strict();
const RawForecast = z.object({
  timezone: z.string(),
  daily_units: z.object({
    temperature_2m_min: z.string(),
    temperature_2m_max: z.string(),
    precipitation_probability_max: z.literal("%"),
  }),
  daily: z.object({
    time: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).length(3),
    temperature_2m_min: z.array(z.number().finite()).length(3),
    temperature_2m_max: z.array(z.number().finite()).length(3),
    precipitation_probability_max: z
      .array(z.number().min(0).max(100))
      .length(3),
  }),
});
const NoteInput = z
  .object({ text: z.string().trim().min(1).max(2000) })
  .strict();
const NoteResponse = z
  .object({
    note: z
      .object({
        id: OpenHuliIdSchema,
        tenantId: OpenHuliIdSchema,
        text: z.string().min(1).max(2000),
        createdAt: z.string().datetime(),
        idempotencyKey: z.string().min(1).max(256),
      })
      .strict(),
  })
  .strict();
const NoteOutput = z
  .object({
    id: OpenHuliIdSchema,
    text: z.string().min(1).max(2000),
    createdAt: z.string().datetime(),
  })
  .strict();
export function createHttpTools(
  config: HttpToolsConfig,
  secrets: SecretStore,
  client?: JsonHttpClient,
): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  if (config.weather) {
    const location = Object.freeze({ ...config.weather });
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      timezone: location.timezone,
      temperature_unit: location.temperatureUnit,
      daily:
        "temperature_2m_min,temperature_2m_max,precipitation_probability_max",
      forecast_days: "3",
    }).toString();
    const fetch = jsonOperation({
      destination: { url: url.href },
      method: "GET",
      expectedStatus: 200,
      input: ForecastInput,
      output: RawForecast,
      ...(client ? { client } : {}),
    });
    tools.push(
      defineTool({
        id: "weather.forecast",
        revision: revision({ url: url.href }),
        effect: "read",
        resource: "tenant",
        risk: "low",
        approval: "never",
        timeoutMs: 6000,
        maxAttempts: 2,
        input: ForecastInput,
        output: Forecast,
        execute: async (args, context) => {
          const raw = await fetch(args, context);
          const unit = location.temperatureUnit === "celsius" ? "°C" : "°F";
          if (
            raw.timezone !== location.timezone ||
            raw.daily_units.temperature_2m_min !== unit ||
            raw.daily_units.temperature_2m_max !== unit
          )
            throw new HttpToolError("invalid_response");
          const days = raw.daily.time
            .slice(0, args.days)
            .map((date, index) => ({
              date,
              minimum: raw.daily.temperature_2m_min[index],
              maximum: raw.daily.temperature_2m_max[index],
              precipitationProbability:
                raw.daily.precipitation_probability_max[index],
            }));
          return {
            kind: "succeeded",
            output: Forecast.parse({
              kind: "forecast",
              source: "Open-Meteo",
              attribution: "Weather data by Open-Meteo.com",
              sourceUrl: "https://open-meteo.com/",
              license: "https://creativecommons.org/licenses/by/4.0/",
              fetchedAt: new Date().toISOString(),
              ...location,
              days,
            }),
          };
        },
      }),
    );
  }
  if (config.notes) {
    const settings = config.notes;
    const common = {
      destination: settings.destination,
      secretReference: settings.secretReference,
      secrets,
      headers: (context: ToolContext) => ({
        "X-Tenant-Id": context.tenantId,
        "Idempotency-Key": context.idempotencyKey,
      }),
      output: NoteResponse,
      ...(client ? { client } : {}),
    };
    const create = jsonOperation({
      ...common,
      method: "POST",
      expectedStatus: 201,
      input: NoteInput,
      body: (args) => ({ text: args.text }),
    });
    const query = jsonOperation({
      ...common,
      method: "GET",
      expectedStatus: 200,
      input: Empty,
    });
    function confirmed(
      response: z.infer<typeof NoteResponse>,
      args: z.infer<typeof NoteInput>,
      context: ToolContext,
    ) {
      if (
        response.note.tenantId !== context.tenantId ||
        response.note.idempotencyKey !== context.idempotencyKey ||
        response.note.text !== args.text
      )
        throw new HttpToolError("invalid_response");
      return {
        kind: "succeeded" as const,
        output: {
          id: response.note.id,
          text: response.note.text,
          createdAt: response.note.createdAt,
        },
      };
    }
    tools.push(
      defineTool({
        id: "notes.create",
        revision: revision({
          url: settings.destination.url,
          privateDemo: settings.destination.privateDemo ?? false,
          secretReference: settings.secretReference,
        }),
        effect: "write",
        resource: "tenant",
        risk: "low",
        approval: "never",
        timeoutMs: 6000,
        maxAttempts: 1,
        input: NoteInput,
        output: NoteOutput,
        execute: async (args, context) =>
          confirmed(await create(args, context), args, context),
        reconcile: async (args, context) => {
          try {
            return confirmed(await query({}, context), args, context);
          } catch {
            return { kind: "unknown" };
          }
        },
      }),
    );
  }
  return tools;
}
export function createHttpToolRegistry(
  config: HttpToolsConfig,
  secrets: SecretStore,
  client?: JsonHttpClient,
) {
  return new ToolRegistry(createHttpTools(config, secrets, client));
}
