import { createServer, type IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import {
  authenticateDeviceMqtt,
  authorizeDeviceMqttClient,
  type DeviceAccessStore,
} from "@corely/modules-devices";
import type { RuntimeConfig } from "./config";

const bodySchema = z
  .object({
    username: z.string().min(1).max(512),
    password: z.string().max(1024),
    clientId: z.string().min(1).max(128),
    topic: z.string().max(256),
    access: z.coerce.number().int(),
    payload: z.string().max(16384),
    retain: z.enum(["true", "false"]).transform((value) => value === "true"),
  })
  .strict();
function equal(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function readBody(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) {
    body += String(chunk);
    if (Buffer.byteLength(body) > 65536)
      throw new Error("Oversized authentication request");
  }
  const params = new URLSearchParams(body);
  if (new Set(params.keys()).size !== [...params].length)
    throw new Error("Duplicate authentication fields");
  return bodySchema.parse(Object.fromEntries(params));
}
export function createMqttAuthBridge(
  config: RuntimeConfig,
  devices: DeviceAccessStore,
  observePresence: (input: {
    identity: string;
    topic: string;
    payload: string;
    retained: boolean;
  }) => Promise<unknown>,
) {
  if (
    !config.RUNTIME_MQTT_AUTH_TOKEN ||
    !config.RUNTIME_MQTT_USERNAME ||
    !config.RUNTIME_MQTT_PASSWORD
  )
    throw new Error("Broker authentication is not configured");
  const secret = config.RUNTIME_MQTT_AUTH_TOKEN,
    serviceName = config.RUNTIME_MQTT_USERNAME,
    servicePassword = config.RUNTIME_MQTT_PASSWORD;
  const server = createServer(
    { requestTimeout: 1500, headersTimeout: 1500, maxHeaderSize: 8192 },
    (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (
        req.method !== "POST" ||
        !["/auth", "/acl"].includes(req.url ?? "") ||
        !equal(String(req.headers["x-openhuli-broker-token"] ?? ""), secret)
      ) {
        res.writeHead(403, { Connection: "close" }).end();
        req.resume();
        return;
      }
      req.setTimeout(1200, () => req.destroy());
      void (async () => {
        const input = await readBody(req);
        if (input.username === serviceName) {
          if (!input.clientId.startsWith("openhuli-"))
            throw new Error("Invalid backend identity");
          if (req.url === "/auth") {
            if (!equal(input.password, servicePassword))
              throw new Error("Invalid backend credential");
          } else {
            const topics = ["telemetry", "manifest", "presence", "results"].map(
              (kind) => `openhuli/v1/devices/+/${kind}`,
            );
            const concrete =
              /^openhuli\/v1\/devices\/[A-Za-z0-9._-]{1,64}\/(telemetry|manifest|presence|results)$/.test(
                input.topic,
              );
            const command =
              /^openhuli\/v1\/devices\/[A-Za-z0-9._-]{1,64}\/commands$/.test(
                input.topic,
              );
            if (
              !(input.access === 4 || input.access === 8
                ? topics.includes(input.topic)
                : input.access === 1
                  ? concrete
                  : input.access === 2 && command && !input.retain)
            )
              throw new Error("Backend topic is denied");
          }
        } else if (req.url === "/auth")
          await authenticateDeviceMqtt(input, devices);
        else {
          await authorizeDeviceMqttClient(input, devices);
          // Mosquitto runs WRITE authorization for Last Will as well as live publishes.
          // Its MESSAGE event excludes Will packets, so attest presence at this private boundary.
          if (input.access === 2 && input.topic.endsWith("/presence"))
            await observePresence({
              identity: input.username,
              topic: input.topic,
              payload: input.payload,
              retained: false,
            });
        }
        res.writeHead(204).end();
      })().catch(() => {
        if (!res.destroyed) res.writeHead(403).end();
      });
    },
  );
  return {
    async start(): Promise<AddressInfo> {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(
          config.RUNTIME_MQTT_AUTH_PORT,
          config.RUNTIME_MQTT_AUTH_HOST,
          () => {
            server.removeListener("error", reject);
            resolve();
          },
        );
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Broker bridge did not bind");
      return address;
    },
    async stop() {
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
