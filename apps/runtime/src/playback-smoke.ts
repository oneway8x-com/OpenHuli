import { createFakeConversationProvider } from "@corely/modules-conversations/testing";
import { setTimeout as pause } from "node:timers/promises";
import { createRuntime } from "./runtime";
import { readRuntimeConfig } from "./config";
import { createConversationRuntime } from "@corely/modules-conversations";
import { OPENHULI_PCM_FORMAT } from "@corely/contracts";
import { runPlaybackSimulator } from "./playback-simulator";

/** --demo uses synthetic tones and in-memory identity on a private loopback listener.
 * --live explicitly opts into provider cost using a real, already-paired speaker profile. */
async function main() {
  const demo = process.argv.includes("--demo");
  if (!demo && !process.argv.includes("--live"))
    throw new Error("Choose --demo or --live (paid provider)");
  let host: ReturnType<typeof createRuntime> | undefined;
  let endpoint =
    process.env.OPENHULI_RUNTIME_URL ?? "ws://127.0.0.1:3200/voice";
  let token = process.env.OPENHULI_DEVICE_TOKEN ?? "";
  if (demo) {
    token = "synthetic-demo-token";
    const pcm24 = new Uint8Array(9600),
      view = new DataView(pcm24.buffer);
    for (let i = 0; i < 4800; i++)
      view.setInt16(
        i * 2,
        Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / 24000)),
        true,
      );
    const fake = createFakeConversationProvider([
      [
        { type: "text", text: "Synthetic streaming demo" },
        { type: "audio", pcm24 },
        { type: "complete" },
      ],
    ]);
    const provider = createConversationRuntime({
      provider: fake.factory,
      journal: {
        async start() {},
        async turn() {},
        async transition() {},
        async message() {},
        async usage() {},
      },
      tools: [],
      async execute() {
        throw new Error("No demo tools");
      },
      maxToolCalls: 1,
      turnTimeoutMs: 5000,
    });
    host = createRuntime(
      readRuntimeConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://synthetic@127.0.0.1/unused",
        RUNTIME_VOICE_ENABLED: "true",
        RUNTIME_PORT: "0",
      }),
      {
        voice: {
          provider,
          authorization: {
            async authenticate(value) {
              if (value !== token) throw new Error("Invalid demo token");
              return {
                identity: {
                  tenantId: "demo",
                  deviceId: "demo",
                  credentialId: "demo",
                  expiresAt: new Date(Date.now() + 60000),
                },
                manifest: {
                  version: 1,
                  type: "device.manifest",
                  messageId: "demo",
                  deviceId: "demo",
                  firmwareVersion: "simulator",
                  capabilities: [
                    { kind: "microphone", format: OPENHULI_PCM_FORMAT },
                    { kind: "speaker", format: OPENHULI_PCM_FORMAT },
                  ],
                },
              };
            },
            async revalidate() {},
            watch() {
              return () => {};
            },
            async close() {},
          },
        },
      },
    );
    const address = await host.start();
    endpoint = `ws://127.0.0.1:${address.port}/voice`;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  try {
    const result = await runPlaybackSimulator({
      endpoint,
      token,
      text: "Say a short greeting.",
      signal: controller.signal,
      async sink(_pcm, signal) {
        await pause(20, undefined, { signal });
      },
    });
    console.log(
      JSON.stringify({
        mode: demo ? "synthetic" : "live",
        sink: "paced-simulator-no-physical-speaker",
        ...result,
      }),
    );
    if (demo && (!result.firstFrameBeforeGeneration || result.frames !== 10))
      throw new Error("Streaming demo invariant failed");
  } finally {
    process.removeListener("SIGINT", cancel);
    await host?.stop();
  }
}
void main().catch(() => {
  console.error("Playback smoke failed; check configuration or cancellation");
  process.exitCode = 1;
});
