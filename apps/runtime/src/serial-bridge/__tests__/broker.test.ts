import { afterAll, beforeAll, expect, it } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type TLSSocket } from "node:tls";
import { generate, parser, type IPublishPacket } from "mqtt-packet";
import { runBridge } from "../run";
import {
  deviceMqttIdentity,
  deviceMqttClientId,
} from "@corely/modules-devices";
const temp = mkdtempSync(join(tmpdir(), "openhuli-usb-tls-")),
  bin = join(temp, "node");
beforeAll(() => {
  const cwd = join(import.meta.dirname, "../../../../..");
  execFileSync(
    process.env.CXX || "c++",
    [
      "-std=c++11",
      "-Ilibraries/OpenHuliSerial/src",
      "libraries/OpenHuliSerial/src/OpenHuliWire.cpp",
      "libraries/OpenHuliSerial/src/OpenHuliNode.cpp",
      "libraries/OpenHuliSerial/test/process.cpp",
      "-o",
      bin,
    ],
    { cwd, timeout: 60000 },
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(temp, "key.pem"),
      "-out",
      join(temp, "ca.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore", timeout: 20000 },
  );
});
afterAll(() => rmSync(temp, { recursive: true, force: true }));
it("runs the production USB bridge over a PTY and verified MQTT TLS, with C++ node completion receipts and retained rejection", async () => {
  // Real OS serial boundary; C++ AVR state machine stands in for unattached physical hardware.
  const helper = spawn(
    "python3",
    [
      "-u",
      "-c",
      `import os,pty,subprocess,sys,time,signal\nsignal.signal(signal.SIGTERM,lambda *_:sys.exit(0))\nm,s=pty.openpty()\nprint(os.ttyname(s),flush=True)\np=subprocess.Popen([sys.argv[1]],stdin=m,stdout=m,stderr=subprocess.DEVNULL)\ntry:\n while True: time.sleep(1)\nfinally: p.terminate();p.wait()`,
      bin,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const path = await new Promise<string>((resolve, reject) => {
    helper.stdout.once("data", (b) => resolve(b.toString().trim()));
    helper.once("error", reject);
  });
  const identity = {
    tenantId: "tenant",
    deviceId: "node",
    credentialId: "credential",
  };
  const config = join(temp, "device.json"),
    fence = join(temp, "state");
  writeFileSync(
    config,
    JSON.stringify({
      device: { id: "node", capabilities: [{ kind: "ping" }] },
      credentials: [
        {
          purpose: "mqtt",
          credentialId: "credential",
          token: "synthetic-token",
          mqttUsername: deviceMqttIdentity(identity),
          mqttClientId: deviceMqttClientId("credential"),
        },
      ],
    }),
    { mode: 0o600 },
  );
  const sockets: TLSSocket[] = [],
    received: IPublishPacket[] = [];
  let connection: TLSSocket | undefined;
  let complete: (() => void) | undefined;
  const acknowledged = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const server = createServer(
    {
      key: readFileSync(join(temp, "key.pem")),
      cert: readFileSync(join(temp, "ca.pem")),
    },
    (socket) => {
      sockets.push(socket);
      connection = socket;
      socket.on("error", () => {});
      const decoder = parser({ protocolVersion: 5 });
      socket.on("data", (data) => decoder.parse(data));
      decoder.on("packet", (packet) => {
        if (packet.cmd === "connect") {
          expect(packet.clean).toBe(true);
          expect(packet.username).toBe(deviceMqttIdentity(identity));
          socket.write(
            generate(
              { cmd: "connack", reasonCode: 0, sessionPresent: false },
              { protocolVersion: 5 },
            ),
          );
        }
        if (packet.cmd === "subscribe")
          socket.write(
            generate(
              { cmd: "suback", messageId: packet.messageId!, granted: [0] },
              { protocolVersion: 5 },
            ),
          );
        if (packet.cmd === "pingreq")
          socket.write(generate({ cmd: "pingresp" }));
        if (packet.cmd === "publish") {
          received.push(packet);
          if (
            packet.topic.endsWith("/presence") &&
            JSON.parse(packet.payload.toString()).status === "online"
          ) {
            const now = Date.now() + 20;
            setTimeout(() => {
              const command = (id: string) =>
                JSON.stringify({
                  version: 1,
                  type: "device.command",
                  messageId: id,
                  commandId: id,
                  executionId: id,
                  deviceId: "node",
                  issuedAt: new Date(now).toISOString(),
                  expiresAt: new Date(now + 3000).toISOString(),
                  action: { kind: "ping" },
                });
              socket.write(
                generate(
                  {
                    cmd: "publish",
                    topic: "openhuli/v1/devices/node/commands",
                    payload: command("retained"),
                    qos: 0,
                    retain: true,
                    dup: false,
                  },
                  { protocolVersion: 5 },
                ),
              );
              socket.write(
                generate(
                  {
                    cmd: "publish",
                    topic: "openhuli/v1/devices/node/commands",
                    payload: command("physical-ping"),
                    qos: 0,
                    retain: false,
                    dup: false,
                  },
                  { protocolVersion: 5 },
                ),
              );
            }, 30);
          }
          if (packet.topic.endsWith("/results")) complete?.();
        }
      });
    },
  );
  server.on("tlsClientError", () => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No broker fixture");
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  try {
    // The same production connector must reject the untrusted fixture CA before opening the port.
    await expect(
      runBridge({
        port: path,
        config,
        mqtt: `mqtts://127.0.0.1:${address.port}`,
        state: fence,
        baud: 19200,
      }),
    ).rejects.toThrow();
    running = runBridge({
      port: path,
      config,
      mqtt: `mqtts://127.0.0.1:${address.port}`,
      state: fence,
      ca: join(temp, "ca.pem"),
      baud: 19200,
      signal: controller.signal,
    });
    await Promise.race([
      acknowledged,
      running.then(() => {
        throw Error("Bridge stopped before receipt");
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Error("No node receipt")), 7000),
      ),
    ]);
    const results = received
      .filter((p) => p.topic.endsWith("/results"))
      .map((p) => JSON.parse(p.payload.toString()));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      commandId: "physical-ping",
      status: "succeeded",
    });
    expect(received.some((p) => p.topic.endsWith("/telemetry"))).toBe(false);
    expect(connection).toBeDefined();
  } finally {
    controller.abort();
    await running?.catch(() => {});
    helper.kill();
    for (const s of sockets) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 15000);
