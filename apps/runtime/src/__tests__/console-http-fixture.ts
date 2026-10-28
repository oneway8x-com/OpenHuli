// Real registered HTTP tools + SQLite notes server; only AI and upstream forecast bytes are synthetic.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonHttpClient, type JsonRequest } from "@corely/modules-http-tools";
import { NotesRepository } from "../../../../packages/modules/notes/src/index";
import { createNotesServer } from "../../../notes-api/src/server";
import { readNotesApiConfig } from "../../../notes-api/src/config";
import { createFakeConversationProvider } from "@corely/modules-conversations/testing";
import type {
  ConversationProvider,
  ConversationProviderFactory,
} from "@corely/modules-conversations";
import { createLiveConversationRuntime } from "../conversation-composition";
import type { RuntimeConfig } from "../config";
export async function createConsoleHttpFixture(config: RuntimeConfig) {
  const directory = mkdtempSync(join(tmpdir(), "openhuli-console-http-"));
  const notes = new NotesRepository(join(directory, "notes.sqlite"));
  const token = "synthetic-console-notes-token-at-least-32-chars";
  const server = createNotesServer(
    readNotesApiConfig({ NOTES_API_TOKEN: token, NOTES_API_PORT: "0" }),
    notes,
  );
  let posts = 0;
  server.on("request", (request) => {
    if (request.method === "POST") posts++;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No notes address");
  class FixtureClient extends JsonHttpClient {
    override async send(request: JsonRequest) {
      if (new URL(request.destination.url).hostname === "api.open-meteo.com")
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
      return super.send(request);
    }
  }
  const provider: ConversationProviderFactory = {
    async open(input) {
      let handle: ConversationProvider | undefined;
      return {
        async begin() {},
        async audio() {},
        async commit(text) {
          const forecast = text?.toLowerCase().includes("forecast");
          const fake = createFakeConversationProvider([
            [
              {
                type: "tool",
                id: `http-${crypto.randomUUID()}`,
                name: forecast ? "weather.forecast" : "notes.create",
                arguments: forecast
                  ? { days: 1 }
                  : { text: text ?? "Synthetic note" },
              },
              {
                type: "text",
                text: forecast
                  ? "Forecast returned; review its source and fetch time."
                  : "Note receipt returned.",
              },
              { type: "complete" },
            ],
          ]);
          handle = await fake.factory.open(input);
          await handle.begin("text");
          await handle.commit(text);
        },
        async next() {
          if (!handle) throw new Error("No turn");
          return handle.next();
        },
        async result(id, name, result) {
          await handle?.result(id, name, result);
        },
        async close() {
          await handle?.close();
        },
      };
    },
  };
  const composition = createLiveConversationRuntime(
    config,
    provider,
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
          secretReference: "console-fixture",
        },
      },
      secrets: {
        async get(reference) {
          if (reference !== "console-fixture")
            throw new Error("Unknown secret");
          return token;
        },
      },
      client: new FixtureClient(),
    },
  );
  return {
    composition,
    posts: () => posts,
    async close() {
      await composition.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      notes.close();
      rmSync(directory, { recursive: true });
    },
  };
}
