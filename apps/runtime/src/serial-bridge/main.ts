import { parseArgs } from "node:util";
async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean" },
      port: { type: "string" },
      config: { type: "string" },
      mqtt: { type: "string" },
      ca: { type: "string" },
      state: { type: "string" },
      baud: { type: "string", default: "19200" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      "USB bridge: --port PORT --config PRIVATE_PAIRING_JSON --mqtt mqtts://HOST --state PRIVATE_FENCE_FILE [--ca PEM_FILE] [--baud 19200]. See docs/guides/SERIAL_DEVICES.md. No ports are auto-opened.",
    );
    return;
  }
  if (!values.port || !values.config || !values.mqtt || !values.state)
    throw new Error("Missing configuration");
  const { runBridge } = await import("./run");
  await runBridge({
    port: values.port,
    config: values.config,
    mqtt: values.mqtt,
    state: values.state,
    ...(values.ca ? { ca: values.ca } : {}),
    baud: Number(values.baud),
  });
}
void main().catch(() => {
  console.error(
    "USB bridge stopped: check private configuration, serial permissions, MQTT TLS and the node handshake. No physical success inferred.",
  );
  process.exitCode = 1;
});
