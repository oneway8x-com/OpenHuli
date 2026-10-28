import { expect, it } from "vitest";
import {
  IntegrationSettingsSchema,
  type IntegrationSettings,
} from "@corely/contracts";
import {
  readIntegrationSettings,
  saveIntegrationSettings,
  tenantHttpConfig,
  testHttpIntegration,
  type HttpIntegrationStore,
} from "../integration.use-cases";
import { JsonHttpClient, type JsonRequest } from "../http-client";
const location = {
  latitude: 52.52,
  longitude: 13.41,
  timezone: "Europe/Berlin",
  temperatureUnit: "celsius" as const,
};
function store(): HttpIntegrationStore {
  const rows = new Map<string, IntegrationSettings>();
  return {
    get: async (id) => rows.get(id),
    save: async (id, value) => {
      rows.set(id, value);
    },
  };
}
it("keeps Tenant settings isolated, validates coordinates/timezone and never stores credentials", async () => {
  const s = store();
  await saveIntegrationSettings(
    { weather: location, weatherEnabled: true, notesEnabled: false },
    { tenantId: "a" },
    s,
  );
  expect(await readIntegrationSettings({ tenantId: "b" }, s, {})).toEqual({
    weather: null,
    weatherEnabled: false,
    notesEnabled: false,
  });
  expect(await tenantHttpConfig({ tenantId: "a" }, s, {})).toEqual({
    weather: location,
  });
  expect(
    IntegrationSettingsSchema.safeParse({
      weather: { ...location, timezone: "bad zone" },
      weatherEnabled: true,
      notesEnabled: false,
    }).success,
  ).toBe(false);
  expect(
    IntegrationSettingsSchema.safeParse({
      weather: { ...location, latitude: 91 },
      weatherEnabled: true,
      notesEnabled: false,
    }).success,
  ).toBe(false);
  await expect(
    saveIntegrationSettings(
      {
        weather: location,
        weatherEnabled: true,
        notesEnabled: false,
        token: "secret",
      },
      { tenantId: "a" },
      s,
    ),
  ).rejects.toThrow();
  await saveIntegrationSettings(
    { weather: location, weatherEnabled: false, notesEnabled: false },
    { tenantId: "a" },
    s,
  );
  expect(
    await tenantHttpConfig({ tenantId: "a" }, s, { weather: location }),
  ).toEqual({});
});
it("notes connection tests only GET fixed authenticated health and suppress secret values in results", async () => {
  const requests: JsonRequest[] = [];
  class Client extends JsonHttpClient {
    override async send(input: JsonRequest) {
      requests.push(input);
      return { ready: true };
    }
  }
  const result = await testHttpIntegration(
    "notes.create",
    { tenantId: "a" },
    {
      notes: {
        destination: { url: "http://127.0.0.1:3300/notes", privateDemo: true },
        secretReference: "private-ref",
      },
    },
    { get: async () => "must-stay-private" },
    new Client(),
  );
  expect(result.ok).toBe(true);
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe("GET");
  expect(requests[0].destination.url).toBe("http://127.0.0.1:3300/health");
  expect(JSON.stringify(result)).not.toContain("must-stay-private");
  await expect(
    testHttpIntegration(
      "notes.create",
      { tenantId: "a" },
      {},
      { get: async () => "" },
      new Client(),
    ),
  ).rejects.toThrow();
});
