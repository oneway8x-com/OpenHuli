import { z } from "zod";
import { validateDestination, type Destination } from "./http-client";
const empty = (value: unknown) => (value === "" ? undefined : value);
const Config = z.object({
  HTTP_WEATHER_LATITUDE: z.preprocess(
    empty,
    z.coerce.number().min(-90).max(90).optional(),
  ),
  HTTP_WEATHER_LONGITUDE: z.preprocess(
    empty,
    z.coerce.number().min(-180).max(180).optional(),
  ),
  HTTP_WEATHER_TIMEZONE: z.preprocess(empty, z.string().max(64).optional()),
  HTTP_WEATHER_TEMPERATURE_UNIT: z
    .enum(["celsius", "fahrenheit"])
    .default("celsius"),
  HTTP_NOTES_URL: z.preprocess(empty, z.string().url().optional()),
  HTTP_NOTES_PRIVATE_DEMO: z.enum(["true", "false"]).default("false"),
  HTTP_NOTES_SECRET_REF: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .default("notes-demo"),
});
export interface HttpToolsConfig {
  weather?: {
    latitude: number;
    longitude: number;
    timezone: string;
    temperatureUnit: "celsius" | "fahrenheit";
  };
  notes?: { destination: Destination; secretReference: string };
}
export function readHttpToolsConfig(env: NodeJS.ProcessEnv): HttpToolsConfig {
  try {
    const c = Config.parse(env);
    const weather =
      c.HTTP_WEATHER_LATITUDE !== undefined ||
      c.HTTP_WEATHER_LONGITUDE !== undefined ||
      c.HTTP_WEATHER_TIMEZONE !== undefined;
    if (
      weather &&
      (c.HTTP_WEATHER_LATITUDE === undefined ||
        c.HTTP_WEATHER_LONGITUDE === undefined ||
        !c.HTTP_WEATHER_TIMEZONE)
    )
      throw new Error();
    if (c.HTTP_WEATHER_TIMEZONE)
      new Intl.DateTimeFormat("en", { timeZone: c.HTTP_WEATHER_TIMEZONE });
    if (!c.HTTP_NOTES_URL && c.HTTP_NOTES_PRIVATE_DEMO === "true")
      throw new Error();
    const notes = c.HTTP_NOTES_URL
      ? {
          destination: {
            url: c.HTTP_NOTES_URL,
            privateDemo: c.HTTP_NOTES_PRIVATE_DEMO === "true",
          },
          secretReference: c.HTTP_NOTES_SECRET_REF,
        }
      : undefined;
    if (notes) validateDestination(notes.destination);
    return {
      ...(weather &&
      c.HTTP_WEATHER_LATITUDE !== undefined &&
      c.HTTP_WEATHER_LONGITUDE !== undefined &&
      c.HTTP_WEATHER_TIMEZONE
        ? {
            weather: {
              latitude: c.HTTP_WEATHER_LATITUDE,
              longitude: c.HTTP_WEATHER_LONGITUDE,
              timezone: c.HTTP_WEATHER_TIMEZONE,
              temperatureUnit: c.HTTP_WEATHER_TEMPERATURE_UNIT,
            },
          }
        : {}),
      ...(notes ? { notes } : {}),
    };
  } catch {
    throw new Error(
      "Invalid HTTP tool configuration; check HTTP_WEATHER_* and HTTP_NOTES_* settings",
    );
  }
}
