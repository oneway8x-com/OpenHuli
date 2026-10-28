import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENHULI_PCM_FORMAT, type PairDeviceInput } from "@corely/contracts";
import {
  authenticateScopedDevice,
  authorizeDeviceMqtt,
  authorizePairedDeviceTool,
  deactivateOwnerDevice,
  getOwnerDevice,
  pairOwnerDevice,
  registerPairedManifest,
  rotateOwnerDeviceSecret,
  assignOwnerDeviceGrant,
  revalidateDeviceSession,
} from "../device-access.use-cases";
import { createDeviceSecret, parseDeviceSecret } from "../device-secrets";
import {
  validateDeviceAdvertisement,
  validateDeviceProfile,
} from "../device-profiles";
import { watchDeviceSession } from "../device-session-watch";
import type {
  DeviceAccessStore,
  StoredAccessDevice,
  StoredAccessCredential,
} from "../device-access.types";
const owner = { tenantId: "tenant-a", userId: "owner" };
const profile: PairDeviceInput = {
  name: "Kitchen",
  room: "Kitchen",
  location: null,
  profileId: "esp32-voice",
  profileVersion: 1,
  capabilities: [
    { kind: "microphone", format: OPENHULI_PCM_FORMAT },
    { kind: "ping" },
  ],
};
const device: StoredAccessDevice = {
  id: "device-a",
  tenantId: owner.tenantId,
  name: "Kitchen",
  status: "active",
  configurationJson: JSON.stringify(profile),
  manifestJson: "{}",
};
const secret = createDeviceSecret(owner.tenantId, device.id);
const credential: StoredAccessCredential = {
  id: secret.credentialId,
  tenantId: owner.tenantId,
  deviceId: device.id,
  purpose: "voice",
  secretHash: secret.secretHash,
  expiresAt: new Date(Date.now() + 100000),
  revokedAt: null,
};
function store(): DeviceAccessStore {
  return {
    pair: vi.fn().mockImplementation(async (tenantId, id, config) => ({
      ...device,
      tenantId,
      id,
      configurationJson: JSON.stringify(config),
    })),
    findDevice: vi.fn().mockResolvedValue(device),
    listDevices: vi.fn().mockResolvedValue([device]),
    credentials: vi.fn().mockResolvedValue([]),
    findCredential: vi.fn().mockResolvedValue(credential),
    saveManifest: vi.fn().mockResolvedValue(true),
    rotateCredential: vi.fn().mockResolvedValue(true),
    revokeCredential: vi.fn().mockResolvedValue(true),
    deactivateDevice: vi.fn().mockResolvedValue(true),
    assignGrant: vi.fn(),
    revokeGrant: vi.fn(),
    grants: vi.fn().mockResolvedValue([]),
    findGrant: vi.fn().mockResolvedValue(null),
  };
}
const manifest = {
  version: 1,
  messageId: "manifest",
  type: "device.manifest",
  deviceId: device.id,
  firmwareVersion: "test",
  capabilities: profile.capabilities,
};
afterEach(() => vi.useRealTimers());
describe("known profile and owner capabilities", () => {
  it("pairs a minimal sensor node without inventing sensors or a voice credential", async () => {
    const config = {
      ...profile,
      profileId: "sensor-node" as const,
      capabilities: [{ kind: "ping" as const }],
    };
    expect(validateDeviceProfile(config).capabilities).toEqual([
      { kind: "ping" },
    ]);
    expect(
      (await pairOwnerDevice(config, owner, store())).credentials.map(
        (c) => c.purpose,
      ),
    ).toEqual(["mqtt"]);
    for (const capabilities of [
      [],
      [{ kind: "temperature" }],
      [{ kind: "ping" }, { kind: "microphone", format: OPENHULI_PCM_FORMAT }],
      [{ kind: "ping" }, { kind: "display", maxTextLength: 33 }],
    ])
      expect(() =>
        validateDeviceProfile({ ...config, capabilities }),
      ).toThrow();
    const displayConfig = {
      ...config,
      capabilities: [
        { kind: "ping" as const },
        { kind: "display" as const, maxTextLength: 32 },
      ],
    };
    expect(
      validateDeviceAdvertisement(
        { ...manifest, capabilities: displayConfig.capabilities },
        device.id,
        displayConfig,
      ),
    ).toBeDefined();
    expect(() =>
      validateDeviceAdvertisement(
        {
          ...manifest,
          capabilities: [...config.capabilities, { kind: "humidity" }],
        },
        device.id,
        config,
      ),
    ).toThrow();
  });
  it("pairs a microphone-only endpoint without inventing ping, speaker or display support", async () => {
    const config: PairDeviceInput = {
      ...profile,
      profileId: "esp32-microphone",
      capabilities: [{ kind: "microphone", format: OPENHULI_PCM_FORMAT }],
    };
    expect(validateDeviceProfile(config).capabilities).toHaveLength(1);
    expect(
      validateDeviceAdvertisement(
        { ...manifest, capabilities: config.capabilities },
        device.id,
        config,
      ).capabilities,
    ).toEqual(config.capabilities);
    expect(
      (await pairOwnerDevice(config, owner, store())).device.profileId,
    ).toBe("esp32-microphone");
    for (const kind of ["ping", "temperature"] as const)
      expect(() =>
        validateDeviceProfile({
          ...config,
          capabilities: [...config.capabilities, { kind }],
        }),
      ).toThrow();
    expect(() =>
      validateDeviceProfile({ ...config, capabilities: [] }),
    ).toThrow();
    // Existing fuller profiles keep their required ping capability.
    expect(() =>
      validateDeviceProfile({ ...config, profileId: "esp32-voice" }),
    ).toThrow();
  });
  it("represents absent display/speaker without inventing hardware", () => {
    expect(validateDeviceProfile(profile).capabilities).toHaveLength(2);
    expect(() =>
      validateDeviceAdvertisement(
        {
          ...manifest,
          capabilities: [
            ...profile.capabilities,
            { kind: "speaker", format: OPENHULI_PCM_FORMAT },
          ],
        },
        device.id,
        profile,
      ),
    ).toThrow("owner-configured");
  });
  it.each([
    { ...profile, profileId: "unknown" },
    { ...profile, profileVersion: 2 },
    { ...profile, capabilities: [{ kind: "ping" }] },
    { ...profile, profileId: "weather-station" },
  ])("rejects unknown/incomplete profiles %#", (value) =>
    expect(() => validateDeviceProfile(value)).toThrow(),
  );
  it("rejects impersonation, duplicate capabilities, altered PCM, and elevated display limits", () => {
    expect(() =>
      validateDeviceAdvertisement(
        { ...manifest, deviceId: "another" },
        device.id,
        profile,
      ),
    ).toThrow("identity");
    expect(() =>
      validateDeviceAdvertisement(
        {
          ...manifest,
          capabilities: [...profile.capabilities, { kind: "ping" }],
        },
        device.id,
        profile,
      ),
    ).toThrow();
    expect(() =>
      validateDeviceProfile({
        ...profile,
        capabilities: [
          {
            kind: "microphone",
            format: { ...OPENHULI_PCM_FORMAT, sampleRateHz: 48000 },
          },
          { kind: "ping" },
        ],
      }),
    ).toThrow();
    const display = {
      ...profile,
      capabilities: [
        ...profile.capabilities,
        { kind: "display" as const, maxTextLength: 32 },
      ],
    };
    expect(() =>
      validateDeviceAdvertisement(
        {
          ...manifest,
          capabilities: [
            ...profile.capabilities,
            { kind: "display", maxTextLength: 33 },
          ],
        },
        device.id,
        display,
      ),
    ).toThrow();
  });
});
describe("pairing and secret lifecycle", () => {
  it("issues independent one-time voice/MQTT tokens and persists only digests", async () => {
    const db = store();
    const result = await pairOwnerDevice(profile, owner, db);
    expect(result.credentials.map((item) => item.purpose)).toEqual([
      "voice",
      "mqtt",
    ]);
    expect(new Set(result.credentials.map((item) => item.token)).size).toBe(2);
    const persisted = vi.mocked(db.pair).mock.calls[0]?.[3];
    expect(JSON.stringify(persisted)).not.toContain("ohd1.");
    expect(
      persisted?.every((item) => /^[a-f0-9]{64}$/.test(item.secretHash)),
    ).toBe(true);
    for (const item of result.credentials)
      expect(parseDeviceSecret(item.token).deviceId).toBe(result.device.id);
  });
  it("weather-only devices receive no voice credential", async () => {
    const result = await pairOwnerDevice(
      {
        ...profile,
        profileId: "weather-station",
        capabilities: [
          { kind: "temperature" },
          { kind: "humidity" },
          { kind: "ping" },
        ],
      },
      owner,
      store(),
    );
    expect(result.credentials.map((item) => item.purpose)).toEqual(["mqtt"]);
  });
  it("rejects malformed/forged credentials and cross-device identity", async () => {
    const db = store();
    await expect(
      authenticateScopedDevice("broken", "voice", db),
    ).rejects.toMatchObject({ status: 401 });
    const forged = createDeviceSecret("tenant-b", "device-b");
    await expect(
      authenticateScopedDevice(forged.token, "voice", db),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateScopedDevice(
        secret.token.slice(0, -1) + (secret.token.endsWith("A") ? "B" : "A"),
        "voice",
        db,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(db.findCredential).toHaveBeenCalledWith(
      "tenant-b",
      forged.credentialId,
    );
  });
  it("checks stored purpose, expiry, revocation, and live device state", async () => {
    const db = store();
    expect(
      (await authenticateScopedDevice(secret.token, "voice", db)).deviceId,
    ).toBe(device.id);
    await expect(
      authenticateScopedDevice(secret.token, "mqtt", db),
    ).rejects.toMatchObject({ status: 401 });
    for (const patch of [
      { expiresAt: new Date(0) },
      { revokedAt: new Date() },
      { purpose: "legacy" },
    ]) {
      vi.mocked(db.findCredential).mockResolvedValue({
        ...credential,
        ...patch,
      });
      await expect(
        authenticateScopedDevice(secret.token, "voice", db),
      ).rejects.toMatchObject({ status: 401 });
    }
    vi.mocked(db.findCredential).mockResolvedValue(credential);
    vi.mocked(db.findDevice).mockResolvedValue({
      ...device,
      status: "revoked",
    });
    await expect(
      authenticateScopedDevice(secret.token, "voice", db),
    ).rejects.toThrow();
  });
  it("rotates conditionally and never discloses secrets from read APIs", async () => {
    const db = store();
    const rotated = await rotateOwnerDeviceSecret(
      device.id,
      { credentialId: credential.id, purpose: "voice" },
      owner,
      db,
    );
    expect(rotated.token).not.toBe(secret.token);
    expect(rotated).not.toHaveProperty("secretHash");
    expect(await getOwnerDevice(device.id, owner, db)).not.toHaveProperty(
      "token",
    );
    vi.mocked(db.rotateCredential).mockResolvedValue(false);
    await expect(
      rotateOwnerDeviceSecret(
        device.id,
        { credentialId: credential.id, purpose: "voice" },
        owner,
        db,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("does not register a device-supplied elevated manifest", async () => {
    const db = store();
    vi.mocked(db.findCredential).mockResolvedValue({
      ...credential,
      purpose: "mqtt",
    });
    await expect(
      registerPairedManifest(
        {
          ...manifest,
          capabilities: [
            ...profile.capabilities,
            { kind: "display", maxTextLength: 32 },
          ],
        },
        secret.token,
        db,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(db.saveManifest).not.toHaveBeenCalled();
    await registerPairedManifest(manifest, secret.token, db);
    expect(db.saveManifest).toHaveBeenCalledWith(
      owner.tenantId,
      device.id,
      manifest,
    );
  });
  it("never deactivates an unscoped device identifier", async () => {
    const db = store();
    await deactivateOwnerDevice(device.id, owner, db);
    expect(db.deactivateDevice).toHaveBeenCalledWith(
      owner.tenantId,
      device.id,
      expect.any(Date),
    );
  });
});
describe("topic and tool boundaries", () => {
  const session = {
    tenantId: owner.tenantId,
    deviceId: device.id,
    credentialId: credential.id,
    purpose: "mqtt" as const,
  };
  it("allows exact own topics and rejects wildcards, cross-device subscriptions, and wrong direction", async () => {
    const db = store();
    vi.mocked(db.findCredential).mockResolvedValue({
      ...credential,
      purpose: "mqtt",
    });
    await authorizeDeviceMqtt(
      session,
      "subscribe",
      `openhuli/v1/devices/${device.id}/commands`,
      db,
    );
    for (const topic of [
      "#",
      "openhuli/v1/+/+/commands",
      `openhuli/v1/devices/device-b/commands`,
      `openhuli/v1/tenant-b/${device.id}/commands`,
      `openhuli/v1/devices/${device.id}/telemetry`,
    ])
      await expect(
        authorizeDeviceMqtt(session, "subscribe", topic, db),
      ).rejects.toMatchObject({ status: 403 });
    await expect(
      authorizeDeviceMqtt(
        session,
        "publish",
        `openhuli/v1/devices/${device.id}/commands`,
        db,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("requires live grants and explicit permitted targets", async () => {
    const db = store();
    vi.mocked(db.findCredential).mockResolvedValue({
      ...credential,
      purpose: "mqtt",
    });
    await expect(
      authorizePairedDeviceTool(session, "device.ping", device.id, db),
    ).rejects.toMatchObject({ status: 403 });
    vi.mocked(db.findGrant).mockResolvedValue({
      targetDeviceIdsJson: JSON.stringify([device.id]),
    });
    await authorizePairedDeviceTool(session, "device.ping", device.id, db);
    await expect(
      authorizePairedDeviceTool(session, "device.ping", null, db),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      authorizePairedDeviceTool(session, "device.ping", "device-b", db),
    ).rejects.toMatchObject({ status: 403 });
    vi.mocked(db.findDevice).mockResolvedValue(null);
    await expect(
      assignOwnerDeviceGrant(
        device.id,
        {
          toolId: "device.ping",
          targetDeviceIds: ["device-b"],
          expiresAt: new Date(Date.now() + 10000).toISOString(),
        },
        owner,
        db,
      ),
    ).rejects.toThrow();
    expect(db.assignGrant).not.toHaveBeenCalled();
  });
  it("revalidation and watchdog stop access after revocation, including database failures", async () => {
    vi.useFakeTimers();
    const db = store();
    vi.mocked(db.findCredential).mockResolvedValue({
      ...credential,
      purpose: "mqtt",
    });
    await revalidateDeviceSession(session, db);
    const close = vi.fn();
    const stop = watchDeviceSession(session, db, close);
    vi.mocked(db.findCredential).mockResolvedValue({
      ...credential,
      purpose: "mqtt",
      revokedAt: new Date(),
    });
    await vi.advanceTimersByTimeAsync(15000);
    expect(close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30000);
    expect(close).toHaveBeenCalledOnce();
    stop();
    vi.mocked(db.findCredential).mockRejectedValue(new Error("offline"));
    const close2 = vi.fn();
    watchDeviceSession(session, db, close2);
    await vi.advanceTimersByTimeAsync(15000);
    expect(close2).toHaveBeenCalledOnce();
  });
  it("closes a connection within twenty seconds when revalidation hangs", async () => {
    vi.useFakeTimers();
    const db = store();
    vi.mocked(db.findCredential).mockImplementation(
      () => new Promise(() => {}),
    );
    const close = vi.fn();
    watchDeviceSession(session, db, close);
    await vi.advanceTimersByTimeAsync(20000);
    expect(close).toHaveBeenCalledOnce();
  });
  it("stops its watchdog when the transport closes normally", async () => {
    vi.useFakeTimers();
    const db = store();
    const close = vi.fn();
    const stop = watchDeviceSession(session, db, close);
    stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(close).not.toHaveBeenCalled();
    expect(db.findCredential).not.toHaveBeenCalled();
  });
});
