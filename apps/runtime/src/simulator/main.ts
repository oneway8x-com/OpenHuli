import { parseArgs } from "node:util";
import { open } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { z } from "zod";
import { runPlaybackSimulator } from "../playback-simulator";
import { simulatorDevice, simulatorEndpoint } from "./device";
import { startMqttSimulator } from "./mqtt-device";

const Receipt = z.object({
  id: z.string().optional(),
  kind: z.string().optional(),
  source: z.string().optional(),
  fetchedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime().optional(),
});
async function localFile(path: string, maximum: number) {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > maximum)
      throw new Error("Simulator file size is outside bounds");
    const bytes = Buffer.alloc(maximum + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        null,
      );
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset > maximum) throw new Error("Simulator file grew past its bound");
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean" },
      "show-response": { type: "boolean" },
      mock: { type: "boolean" },
      live: { type: "boolean" },
      device: { type: "boolean" },
      config: { type: "string" },
      pcm: { type: "string" },
      endpoint: { type: "string" },
      mqtt: { type: "string" },
      fault: { type: "string" },
      duration: { type: "string" },
      interval: { type: "string" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      "Use --mock with TEST_DATABASE_URL, --live --config FILE --pcm FILE --endpoint WSS_URL, or --device --config FILE --mqtt MQTT_URL. See docs/guides/DEVICE_SIMULATOR.md for faults and live approval/evidence.",
    );
    return;
  }
  if ([values.mock, values.live, values.device].filter(Boolean).length !== 1)
    throw new Error(
      "Choose exactly one of --mock, --live (paid provider), or --device",
    );
  const fault = z
    .enum([
      "cancel",
      "disconnect",
      "unsupported-display",
      "delayed-ack",
      "duplicate",
      "stale",
    ])
    .optional()
    .parse(values.fault);
  if (values.mock && (values.config || values.endpoint || values.mqtt))
    throw new Error("Mock mode only uses its isolated fixture");
  if (!values.device && fault && !["cancel", "disconnect"].includes(fault))
    throw new Error("This fault requires --device");
  if (values.device && fault && ["cancel", "disconnect"].includes(fault))
    throw new Error("This fault requires a voice mode");
  if (
    (values.device && (values.pcm || values.endpoint)) ||
    (!values.device && (values.mqtt || values.interval || values.duration))
  )
    throw new Error("Options do not match the selected simulator mode");
  const durationSeconds = z.coerce
    .number()
    .int()
    .min(1)
    .max(300)
    .parse(values.duration ?? 30);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let mock:
    | Awaited<
        ReturnType<typeof import("./mock-runtime").createMockSimulatorRuntime>
      >
    | undefined;
  let mqtt: Awaited<ReturnType<typeof startMqttSimulator>> | undefined;
  try {
    if (values.mock)
      mock = await (
        await import("./mock-runtime")
      ).createMockSimulatorRuntime();
    const device =
      mock?.device ??
      simulatorDevice(
        JSON.parse(
          (
            await localFile(z.string().min(1).parse(values.config), 16384)
          ).toString("utf8"),
        ),
        fault === "unsupported-display",
      );
    if (values.device) {
      mqtt = await startMqttSimulator({
        endpoint: z.string().min(1).parse(values.mqtt),
        device,
        signal: controller.signal,
        intervalSeconds: z.coerce
          .number()
          .int()
          .min(1)
          .max(3600)
          .parse(values.interval ?? 30),
        stale: fault === "stale",
        duplicate: fault === "duplicate",
        acknowledgementDelayMs: fault === "delayed-ack" ? 10000 : 0,
        onCommand: (event) =>
          console.log(JSON.stringify({ mode: "synthetic-device", ...event })),
      });
      console.log(
        JSON.stringify({
          mode: "synthetic-device",
          state: "connected",
          deviceId: device.manifest.deviceId,
          fault: fault ?? null,
        }),
      );
      await pause(durationSeconds * 1000, undefined, {
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) throw error;
      });
      return;
    }
    const pcm = values.pcm
      ? new Uint8Array(await localFile(values.pcm, 320000))
      : values.mock
        ? new Uint8Array(640 * 20)
        : undefined;
    if (!pcm || pcm.length % 640 !== 0 || pcm.length < 640)
      throw new Error(
        "Supply --pcm with 1–500 whole 20ms PCM16LE mono frames, without a WAV header",
      );
    if (
      !device.voiceToken ||
      !device.manifest.capabilities.some((cap) => cap.kind === "microphone")
    )
      throw new Error("A paired microphone voice credential is required");
    const result = await runPlaybackSimulator({
      endpoint: simulatorEndpoint(
        mock?.endpoint ?? z.string().min(1).parse(values.endpoint),
        "voice",
      ),
      token: device.voiceToken,
      pcm,
      speaker: device.manifest.capabilities.some(
        (cap) => cap.kind === "speaker",
      ),
      signal: controller.signal,
      ...(fault === "cancel" || fault === "disconnect"
        ? {
            interrupt: {
              kind: fault,
              afterFrames: Math.max(1, Math.floor(pcm.length / 1280)),
            },
          }
        : {}),
      onEvent(message) {
        if (message.type === "response.text" && values["show-response"])
          console.log(
            JSON.stringify({
              mode: values.mock ? "mock" : "live-provider",
              turnId: message.turnId,
              response: message.text,
            }),
          );
        if (message.type === "tool.result")
          console.log(
            JSON.stringify({
              mode: values.mock ? "mock" : "live-provider",
              turnId: message.turnId,
              executionId: message.executionId,
              status: message.status,
            }),
          );
      },
      async sink(_pcm, signal) {
        await pause(20, undefined, { signal });
      },
    });
    let evidence:
      | {
          executionId: string;
          toolId: string;
          status: string;
          toolCallId: string;
          receipt: z.infer<typeof Receipt>;
        }[]
      | undefined;
    if (mock) {
      const executions = await mock.executions();
      evidence = executions.map((record) => ({
        executionId: record.id,
        toolId: record.toolName,
        status: record.status,
        toolCallId: record.toolCallId,
        receipt: Receipt.parse(JSON.parse(record.outputJson ?? "{}")),
      }));
      if (
        !fault &&
        (mock.notesPosts() !== 1 ||
          evidence.length !== 2 ||
          evidence.some((item) => item.status !== "succeeded"))
      )
        throw new Error("Mock vertical scenario did not confirm both tools");
    }
    console.log(
      JSON.stringify({
        mode: values.mock ? "mock" : "live-provider",
        provider: values.mock ? "scripted-synthetic" : "remote-runtime",
        forecast: values.mock
          ? "synthetic-fixture"
          : "inspect-correlated-owner-execution",
        notes: values.mock
          ? { transport: "actual-local-HTTP", posts: mock?.notesPosts() ?? 0 }
          : "inspect-correlated-owner-execution",
        sink: "paced-software-no-physical-speaker",
        ...result,
        ...(evidence ? { evidence } : {}),
      }),
    );
    if (
      !fault &&
      (result.toolResults.length === 0 ||
        result.toolResults.some((item) => item.status !== "succeeded") ||
        !result.responseCharacters)
    )
      throw new Error("No completed successful tool turn confirmed");
  } finally {
    await mqtt?.stop();
    await mock?.close();
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}
void main().catch(() => {
  console.error(
    "Simulator failed; check mode, local test setup, paired credentials, endpoint and PCM format. No live success established.",
  );
  process.exitCode = 1;
});
