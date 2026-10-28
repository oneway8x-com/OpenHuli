import { expect, it, vi } from "vitest";
import { OpenHuliCommandReceiver } from "../command-receiver";
import { OPENHULI_PCM_FORMAT } from "../common";
import type { DeviceCapabilityManifest, DeviceCommand } from "../device";
const manifest: DeviceCapabilityManifest = {
  version: 1,
  type: "device.manifest",
  messageId: "manifest",
  deviceId: "device",
  firmwareVersion: "synthetic",
  capabilities: [
    { kind: "microphone", format: OPENHULI_PCM_FORMAT },
    { kind: "ping" },
  ],
};
const now = Date.parse("2026-10-28T12:00:00Z");
const command = (changes = {}): DeviceCommand => ({
  version: 1,
  type: "device.command",
  messageId: "command",
  commandId: "command",
  executionId: "execution",
  deviceId: "device",
  issuedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 5000).toISOString(),
  action: { kind: "ping" },
  ...changes,
});
it("coalesces concurrent/repeated IDs into one effect and the same receipt", async () => {
  const receiver = new OpenHuliCommandReceiver(
    manifest,
    () => now,
    () => true,
  );
  const effect = vi.fn(async () => "succeeded" as const),
    wire = JSON.stringify(command());
  const [a, b] = await Promise.all([
    receiver.receive(wire, effect),
    receiver.receive(wire, effect),
  ]);
  expect(a).toEqual(b);
  expect(a.status).toBe("succeeded");
  expect(effect).toHaveBeenCalledOnce();
  expect(await receiver.receive(wire, effect)).toEqual(a);
  expect(effect).toHaveBeenCalledOnce();
  expect(() =>
    receiver.receive(
      JSON.stringify(command({ executionId: "different" })),
      effect,
    ),
  ).toThrow("identity");
});
it("fails closed for clock/expiry, missing display, wrong target and bounded capacity", async () => {
  const effect = vi.fn(async () => "succeeded" as const);
  const receiver = new OpenHuliCommandReceiver(
    manifest,
    () => now,
    () => true,
    1,
  );
  expect(
    (
      await receiver.receive(
        JSON.stringify(
          command({
            expiresAt: new Date(now - 1).toISOString(),
            issuedAt: new Date(now - 1000).toISOString(),
          }),
        ),
        effect,
      )
    ).status,
  ).toBe("expired");
  expect(
    (
      await receiver.receive(
        JSON.stringify(
          command({ action: { kind: "display.write", text: "Hello" } }),
        ),
        effect,
      )
    ).status,
  ).toBe("failed");
  expect(() =>
    receiver.receive(JSON.stringify(command({ deviceId: "another" })), effect),
  ).toThrow("target");
  expect(
    (
      await new OpenHuliCommandReceiver(
        manifest,
        () => now,
        () => false,
      ).receive(JSON.stringify(command()), effect)
    ).status,
  ).toBe("expired");
  await receiver.receive(JSON.stringify(command()), effect);
  expect(
    (
      await receiver.receive(
        JSON.stringify(command({ commandId: "overflow" })),
        effect,
      )
    ).status,
  ).toBe("failed");
  expect(effect).toHaveBeenCalledOnce();
});
it("reports uncertain physical effects and never executes an expired duplicate", async () => {
  let time = now;
  const receiver = new OpenHuliCommandReceiver(
    manifest,
    () => time,
    () => true,
  );
  const effect = vi.fn(async (): Promise<"succeeded"> => {
    throw new Error("lost physical result");
  });
  expect(
    (await receiver.receive(JSON.stringify(command()), effect)).status,
  ).toBe("unknown");
  time += 6000;
  expect(
    (await receiver.receive(JSON.stringify(command()), effect)).status,
  ).toBe("expired");
  expect(effect).toHaveBeenCalledOnce();
});

it("does not revive a pruned command when the wall clock moves backwards", async () => {
  let time = now;
  const effect = vi.fn(async () => "succeeded" as const);
  const receiver = new OpenHuliCommandReceiver(
    manifest,
    () => time,
    () => true,
  );
  await receiver.receive(JSON.stringify(command()), effect);
  time += 6000;
  await receiver.receive(JSON.stringify(command()), effect);
  time = now + 1;
  expect(
    (await receiver.receive(JSON.stringify(command()), effect)).status,
  ).toBe("expired");
  expect(effect).toHaveBeenCalledOnce();
});

it("rechecks time immediately before the effect starts", async () => {
  let time = now;
  const effect = vi.fn(async () => "succeeded" as const);
  const receiver = new OpenHuliCommandReceiver(
    manifest,
    () => time,
    () => true,
  );
  const pending = receiver.receive(JSON.stringify(command()), effect);
  time = now - 1;
  expect((await pending).status).toBe("expired");
  expect(effect).not.toHaveBeenCalled();
});
