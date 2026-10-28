/** Packet-level broker fixture: real TCP/MQTT client, not Mosquitto authorization evidence. */
import { createServer, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { afterEach, expect, it } from "vitest";
import {
  parser,
  generate,
  type IConnectPacket,
  type IPublishPacket,
} from "mqtt-packet";
import { simulatorDevice } from "../simulator/device";
import { startMqttSimulator } from "../simulator/mqtt-device";
import {
  deviceMqttIdentity,
  deviceMqttClientId,
} from "@corely/modules-devices";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const sockets: Socket[] = [],
    packets: { packet: IPublishPacket; at: number }[] = [];
  let connection: IConnectPacket | undefined,
    stall = false;
  const server = createServer((socket) => {
    sockets.push(socket);
    const decoder = parser({ protocolVersion: 5 });
    socket.on("data", (data) => decoder.parse(data));
    decoder.on("packet", (packet) => {
      if (packet.cmd === "connect") {
        connection = packet;
        socket.write(
          generate(
            { cmd: "connack", reasonCode: 0, sessionPresent: false },
            { protocolVersion: 5 },
          ),
        );
      }
      if (packet.cmd === "subscribe" && packet.messageId !== undefined)
        socket.write(
          generate(
            {
              cmd: "suback",
              messageId: packet.messageId,
              granted: packet.subscriptions.map(() => 1),
            },
            { protocolVersion: 5 },
          ),
        );
      if (packet.cmd === "publish") {
        packets.push({ packet, at: Date.now() });
        if (
          packet.qos === 1 &&
          packet.messageId &&
          !(stall && packet.topic.endsWith("/telemetry"))
        )
          socket.write(
            generate(
              { cmd: "puback", messageId: packet.messageId },
              { protocolVersion: 5 },
            ),
          );
      }
      if (packet.cmd === "pingreq") socket.write(generate({ cmd: "pingresp" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  cleanup.push(async () => {
    sockets.forEach((s) => s.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const identity = {
    tenantId: "tenant",
    deviceId: "station",
    credentialId: "credential",
  };
  const device = simulatorDevice({
    device: {
      id: "station",
      capabilities: [
        { kind: "temperature" },
        { kind: "humidity" },
        { kind: "ping" },
      ],
    },
    credentials: [
      {
        purpose: "mqtt",
        credentialId: "credential",
        token: "synthetic",
        mqttUsername: deviceMqttIdentity(identity),
        mqttClientId: deviceMqttClientId("credential"),
      },
    ],
  });
  const rows = (suffix: string) =>
    packets.filter((row) => row.packet.topic.endsWith(suffix));
  const command = (kind: "ping" | "display.write", lifetime = 5000) => {
    const id = randomUUID();
    return {
      version: 1,
      messageId: id,
      type: "device.command",
      deviceId: "station",
      commandId: id,
      executionId: id,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + lifetime).toISOString(),
      action: kind === "ping" ? { kind } : { kind, text: "Synthetic display" },
    };
  };
  return {
    device,
    endpoint: `mqtt://127.0.0.1:${address.port}`,
    rows,
    connection: () => connection,
    stall: () => {
      stall = true;
    },
    command,
    send(wire: unknown) {
      const socket = sockets[0];
      if (!socket) throw new Error("No connected simulator");
      socket.write(
        generate(
          {
            cmd: "publish",
            topic: "openhuli/v1/devices/station/commands",
            payload: JSON.stringify(wire),
            qos: 0,
            retain: false,
            dup: false,
          },
          { protocolVersion: 5 },
        ),
      );
    },
  };
}
it("publishes scoped manifest, separate presence, stale duplicated readings, and graceful offline", async () => {
  const f = await fixture();
  const client = await startMqttSimulator({
    endpoint: f.endpoint,
    device: f.device,
    stale: true,
    duplicate: true,
  });
  cleanup.push(client.stop);
  expect(f.connection()?.username).toBe(f.device.mqtt?.username);
  expect(JSON.parse(String(f.connection()?.will?.payload))).toMatchObject({
    status: "offline",
    sequence: 1,
  });
  const samples = f.rows("/telemetry");
  expect(samples).toHaveLength(2);
  expect(String(samples[0]?.packet.payload)).toBe(
    String(samples[1]?.packet.payload),
  );
  expect(
    Date.now() -
      Date.parse(JSON.parse(String(samples[0]?.packet.payload)).sampledAt),
  ).toBeGreaterThanOrEqual(120000);
  await client.stop();
  expect(
    JSON.parse(String(f.rows("/presence").at(-1)?.packet.payload)).status,
  ).toBe("offline");
});
it("returns unsupported display and duplicate receipts, with deliberately delayed acknowledgement", async () => {
  const f = await fixture();
  const client = await startMqttSimulator({
    endpoint: f.endpoint,
    device: f.device,
    duplicate: true,
    acknowledgementDelayMs: 250,
  });
  cleanup.push(client.stop);
  const display = f.command("display.write");
  f.send(display);
  await expect.poll(() => f.rows("/results").length).toBe(2);
  expect(
    JSON.parse(String(f.rows("/results")[0]?.packet.payload)),
  ).toMatchObject({
    status: "failed",
    error: { code: "unsupported_capability" },
  });
  const ping = f.command("ping", 150);
  f.send(ping);
  f.send(ping);
  await pause(30);
  expect(f.rows("/results")).toHaveLength(2);
  await expect.poll(() => f.rows("/results").length).toBe(6);
  const receipts = f.rows("/results").slice(2);
  expect(new Set(receipts.map((r) => String(r.packet.payload))).size).toBe(1);
  expect(receipts.every((r) => r.at >= Date.parse(ping.expiresAt))).toBe(true);
});
it("bounds a missing publish acknowledgement and shutdown rather than hanging", async () => {
  const f = await fixture();
  const client = await startMqttSimulator({
    endpoint: f.endpoint,
    device: f.device,
  });
  cleanup.push(client.stop);
  f.stall();
  await expect(client.publishSample()).rejects.toThrow("timed out");
  await client.stop();
});
