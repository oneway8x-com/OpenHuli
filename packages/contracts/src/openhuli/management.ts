import { z } from "zod";
import { OpenHuliIdSchema } from "./common";
import { OpenHuliApprovalDecisionSchema } from "./execution";

export const ForecastSettingsSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    timezone: z
      .string()
      .min(1)
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Use a valid timezone"),
    temperatureUnit: z.enum(["celsius", "fahrenheit"]),
  })
  .strict();
export const IntegrationSettingsSchema = z
  .object({
    weather: ForecastSettingsSchema.nullable(),
    weatherEnabled: z.boolean(),
    notesEnabled: z.boolean(),
  })
  .strict()
  .refine(
    (v) => !v.weatherEnabled || v.weather !== null,
    "Forecast location required",
  );
export type IntegrationSettings = z.infer<typeof IntegrationSettingsSchema>;
export const ManagementCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("command"),
      deviceId: OpenHuliIdSchema,
      requestId: z.string().uuid(),
      toolId: z.enum(["device.ping", "display.message"]),
      text: z.string().min(1).max(512).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("approval"),
      decision: OpenHuliApprovalDecisionSchema.extend({
        requestHash: z.string().regex(/^[a-f0-9]{64}$/),
        targetDeviceId: OpenHuliIdSchema.nullable(),
      }),
    })
    .strict(),
  z
    .object({ action: z.literal("cancel"), executionId: OpenHuliIdSchema })
    .strict(),
  z
    .object({
      action: z.literal("settings"),
      settings: IntegrationSettingsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("test"),
      toolId: z.enum(["weather.forecast", "notes.create"]),
    })
    .strict(),
]);
