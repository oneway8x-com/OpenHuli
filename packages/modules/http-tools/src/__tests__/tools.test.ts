import { describe, expect, it, vi } from "vitest";
import { createHttpTools } from "../tools";
import { readHttpToolsConfig } from "../config";
import { JsonHttpClient } from "../http-client";
import { jsonOperation } from "../http-operation";
import { z } from "zod";
const context = {
  tenantId: "tenant",
  executionId: "execution",
  idempotencyKey: "openhuli:tenant:execution",
  targetDeviceId: null,
  signal: new AbortController().signal,
};
const weather = {
  latitude: 52.52,
  longitude: 13.41,
  timezone: "Europe/Berlin",
  temperatureUnit: "celsius" as const,
};
const raw = {
  timezone: "Europe/Berlin",
  daily_units: {
    temperature_2m_min: "°C",
    temperature_2m_max: "°C",
    precipitation_probability_max: "%",
  },
  daily: {
    time: ["2026-10-27", "2026-10-28", "2026-10-29"],
    temperature_2m_min: [2, 3, 4],
    temperature_2m_max: [8, 9, 10],
    precipitation_probability_max: [20, 30, 40],
  },
};
describe("registered HTTP mappings and configuration", () => {
  it("maps forecast evidence with configured location/units/attribution and rejects model destination overrides", async () => {
    const client = new JsonHttpClient();
    const send = vi.spyOn(client, "send").mockResolvedValue(raw);
    const tool = createHttpTools(
      { weather },
      { get: async () => "unused" },
      client,
    )[0]!;
    const result = await tool.execute({ days: 2 }, context);
    expect(result).toMatchObject({
      kind: "succeeded",
      output: {
        kind: "forecast",
        timezone: weather.timezone,
        latitude: weather.latitude,
        temperatureUnit: "celsius",
        attribution: "Weather data by Open-Meteo.com",
        days: [
          {
            date: "2026-10-27",
            minimum: 2,
            maximum: 8,
            precipitationProbability: 20,
          },
          {
            date: "2026-10-28",
            minimum: 3,
            maximum: 9,
            precipitationProbability: 30,
          },
        ],
      },
    });
    expect(send.mock.calls[0]?.[0].destination.url).toContain(
      "https://api.open-meteo.com/v1/forecast?",
    );
    await expect(
      tool.execute({ days: 1, url: "http://localhost/" }, context),
    ).rejects.toThrow();
    send.mockResolvedValue({
      ...raw,
      daily_units: { ...raw.daily_units, temperature_2m_min: "°F" },
    });
    await expect(tool.execute({ days: 1 }, context)).rejects.toThrow(
      "invalid_response",
    );
  });
  it("resolves server secrets, fixes methods/body/headers, and validates exact notes receipt identity", async () => {
    const client = new JsonHttpClient();
    const note = {
      id: "note",
      tenantId: "tenant",
      idempotencyKey: context.idempotencyKey,
      text: "A note",
      createdAt: new Date().toISOString(),
    };
    const send = vi.spyOn(client, "send").mockResolvedValue({ note });
    const get = vi.fn(async () => "server-secret");
    const tool = createHttpTools(
      {
        notes: {
          destination: { url: "https://notes.example.test/notes" },
          secretReference: "note-secret-ref",
        },
      },
      { get },
      client,
    )[0]!;
    expect(await tool.execute({ text: " A note " }, context)).toMatchObject({
      kind: "succeeded",
      output: { id: "note", text: "A note" },
    });
    expect(get).toHaveBeenCalledWith("note-secret-ref");
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      method: "POST",
      body: { text: "A note" },
      headers: {
        Authorization: "Bearer server-secret",
        "Idempotency-Key": context.idempotencyKey,
        "X-Tenant-Id": context.tenantId,
      },
    });
    expect(tool.maxAttempts).toBe(1);
    await tool.reconcile?.({ text: "A note" }, context);
    expect(send.mock.calls[1]?.[0]).toMatchObject({ method: "GET" });
    expect(send.mock.calls[1]?.[0].body).toBeUndefined();
    send.mockResolvedValue({ note: { ...note, tenantId: "another" } });
    await expect(tool.execute({ text: "A note" }, context)).rejects.toThrow(
      "invalid_response",
    );
    expect(await tool.reconcile?.({ text: "A note" }, context)).toEqual({
      kind: "unknown",
    });
    await expect(
      tool.execute({ text: "A note", secretReference: "attacker" }, context),
    ).rejects.toThrow();
  });
  it("changes registered policy when destination or location configuration changes", () => {
    const secrets = { get: async () => "synthetic" };
    const first = createHttpTools(
      {
        notes: {
          destination: { url: "https://one.example.test/notes" },
          secretReference: "demo",
        },
      },
      secrets,
    )[0]!;
    const second = createHttpTools(
      {
        notes: {
          destination: { url: "https://two.example.test/notes" },
          secretReference: "demo",
        },
      },
      secrets,
    )[0]!;
    expect(first.policyHash).not.toBe(second.policyHash);
    const a = createHttpTools({ weather }, secrets)[0]!;
    const b = createHttpTools(
      { weather: { ...weather, latitude: 48 } },
      secrets,
    )[0]!;
    expect(a.policyHash).not.toBe(b.policyHash);
  });
  it("redacts missing/invalid secret errors without connecting", async () => {
    const client = new JsonHttpClient();
    const send = vi.spyOn(client, "send");
    const operation = jsonOperation({
      destination: { url: "https://notes.example.test/notes" },
      method: "POST",
      expectedStatus: 201,
      input: z.object({}).strict(),
      output: z.object({}).strict(),
      secretReference: "ref",
      secrets: {
        get: async () => {
          throw new Error("private credential value");
        },
      },
      client,
    });
    await expect(operation({}, context)).rejects.toThrow("unavailable");
    expect(send).not.toHaveBeenCalled();
  });
  it("requires a complete location and explicitly scoped private demo configuration", () => {
    expect(readHttpToolsConfig({})).toEqual({});
    for (const config of [
      { HTTP_WEATHER_LATITUDE: "52" },
      {
        HTTP_WEATHER_LATITUDE: "52",
        HTTP_WEATHER_LONGITUDE: "13",
        HTTP_WEATHER_TIMEZONE: "Bad/Zone",
      },
      { HTTP_NOTES_URL: "http://127.0.0.1:3300/notes" },
      {
        HTTP_NOTES_URL: "http://10.0.0.1/notes",
        HTTP_NOTES_PRIVATE_DEMO: "true",
      },
      { HTTP_NOTES_PRIVATE_DEMO: "true" },
    ])
      expect(() => readHttpToolsConfig(config)).toThrow(
        "Invalid HTTP tool configuration",
      );
    expect(
      readHttpToolsConfig({
        HTTP_NOTES_URL: "http://127.0.0.1:3300/notes",
        HTTP_NOTES_PRIVATE_DEMO: "true",
      }).notes?.destination.privateDemo,
    ).toBe(true);
  });
});
