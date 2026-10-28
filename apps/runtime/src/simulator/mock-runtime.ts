/** Explicit simulator fixture: synthetic AI + forecast, real credentials/executor/HTTP notes. */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonHttpClient, type JsonRequest } from "@corely/modules-http-tools";
import { createFakeConversationProvider } from "@corely/modules-conversations/testing";
import { readAuthConfig } from "@corely/modules-identity";
import { preauthorizeTool } from "@corely/modules-tool-execution";
import { NotesRepository } from "@corely/modules-notes";
import { createNotesServer } from "../../../notes-api/src/server";
import { readNotesApiConfig } from "../../../notes-api/src/config";
import { getTestDatabaseUrl } from "../../../../scripts/test-database";
import { createRuntime } from "../runtime";
import { readRuntimeConfig } from "../config";
import { createLiveConversationRuntime } from "../conversation-composition";
import { createVoiceAuthorization } from "../device-authorization";
import { simulatorDevice } from "./device";
import { SimulatorFixtureRepository } from "./fixture.repository";

export async function createMockSimulatorRuntime() {
  const database = getTestDatabaseUrl(); // Guard before constructing any persistence adapter or writing.
  const previous = new Map(
    ["DATABASE_URL", "OWNER_EMAIL", "JWT_SECRET", "APP_URL"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  const email = `simulator-${randomUUID()}@example.test`;
  Object.assign(process.env, {
    DATABASE_URL: database,
    OWNER_EMAIL: email,
    JWT_SECRET: `synthetic-simulator-${randomUUID()}`,
    APP_URL: "http://localhost:3000",
  });
  const store = new SimulatorFixtureRepository();
  const directory = await mkdtemp(join(tmpdir(), "openhuli-simulator-"));
  const notes = new NotesRepository(join(directory, "notes.sqlite"));
  const secret = `synthetic-notes-${randomUUID()}`;
  const server = createNotesServer(
    readNotesApiConfig({ NOTES_API_TOKEN: secret }),
    notes,
  );
  let posts = 0;
  server.on("request", (request) => {
    if (request.method === "POST") posts++;
  });
  const fake = createFakeConversationProvider([
    [
      {
        type: "tool",
        id: "forecast-call",
        name: "weather.forecast",
        arguments: { days: 1 },
      },
      {
        type: "tool",
        id: "note-call",
        name: "notes.create",
        arguments: { text: "Synthetic simulator note" },
      },
      {
        type: "text",
        text: "Synthetic forecast and real local note receipt returned.",
      },
      { type: "audio", pcm24: new Uint8Array(960) },
      { type: "complete" },
    ],
  ]);
  class ForecastFixture extends JsonHttpClient {
    override async send(request: JsonRequest) {
      if (new URL(request.destination.url).hostname !== "api.open-meteo.com")
        return super.send(request);
      return {
        timezone: "Europe/Berlin",
        daily_units: {
          temperature_2m_min: "°C",
          temperature_2m_max: "°C",
          precipitation_probability_max: "%",
        },
        daily: {
          time: ["2026-10-28", "2026-10-29", "2026-10-30"],
          temperature_2m_min: [2, 3, 4],
          temperature_2m_max: [8, 9, 10],
          precipitation_probability_max: [20, 30, 40],
        },
      };
    }
  }
  let composition: ReturnType<typeof createLiveConversationRuntime> | undefined;
  let host: ReturnType<typeof createRuntime> | undefined;
  async function close() {
    try {
      await host?.stop();
      await composition?.close();
      if (server.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      notes.close();
      await store.close();
      await rm(directory, { recursive: true });
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
  try {
    const provisioned = await store.create(readAuthConfig());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No mock notes listener");
    const config = readRuntimeConfig({
      NODE_ENV: "test",
      DATABASE_URL: database,
      RUNTIME_VOICE_ENABLED: "true",
      RUNTIME_PORT: "0",
    });
    composition = createLiveConversationRuntime(
      config,
      fake.factory,
      undefined,
      {
        config: {
          weather: {
            latitude: 52.52,
            longitude: 13.41,
            timezone: "Europe/Berlin",
            temperatureUnit: "celsius",
          },
          notes: {
            destination: {
              url: `http://127.0.0.1:${address.port}/notes`,
              privateDemo: true,
            },
            secretReference: "simulator-only",
          },
        },
        secrets: {
          async get(reference) {
            if (reference !== "simulator-only")
              throw new Error("Unknown fixture reference");
            return secret;
          },
        },
        client: new ForecastFixture(),
      },
    );
    // Explicit fixture-owner consent, restricted to this disposable source device and policy.
    await preauthorizeTool(
      {
        toolId: "notes.create",
        sourceDeviceId: provisioned.paired.device.id,
        targetDeviceId: null,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      { kind: "owner", token: provisioned.ownerToken },
      composition.tools,
    );
    host = createRuntime(config, {
      voice: {
        authorization: createVoiceAuthorization(),
        provider: composition,
      },
    });
    const listener = await host.start();
    return {
      endpoint: `ws://127.0.0.1:${listener.port}/voice`,
      device: simulatorDevice(provisioned.paired),
      trace: fake.trace,
      executions: () => store.executions(),
      notesPosts: () => posts,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
