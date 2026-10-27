import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { OPENHULI_PCM_FORMAT, type PairDeviceInput } from "@corely/contracts";
import {
  hashRefreshToken,
  issueAccessToken,
  newRefreshToken,
  readAuthConfig,
} from "@corely/modules-identity";
import {
  authenticateScopedDevice,
  authorizePairedDeviceTool,
  DeviceAccessRepository,
  pairOwnerDevice,
  revalidateDeviceSession,
} from "@corely/modules-devices";
import { getPrisma } from "../prisma";
import { getTestDatabaseUrl } from "../../../../../scripts/test-database";
import { GET as list, POST as pair } from "../../../app/api/devices/route";
import {
  GET as detail,
  DELETE as deactivate,
} from "../../../app/api/devices/[id]/route";
import { POST as rotate } from "../../../app/api/devices/[id]/credentials/route";
import { DELETE as revoke } from "../../../app/api/devices/[id]/credentials/[credentialId]/route";
import { PUT as grant } from "../../../app/api/devices/[id]/grants/route";
import { DELETE as revokeGrant } from "../../../app/api/devices/[id]/grants/[toolId]/route";
import { POST as manifest } from "../../../app/api/device/manifest/route";

process.env.DATABASE_URL = getTestDatabaseUrl();
process.env.OWNER_EMAIL = `pairing-${randomUUID()}@example.test`;
const db = getPrisma(),
  store = new DeviceAccessRepository(db),
  config = readAuthConfig();
const profile: PairDeviceInput = {
  name: "Synthetic kitchen",
  room: "Kitchen",
  location: { label: "Test coordinates", latitude: 52, longitude: 13 },
  profileId: "esp32-voice",
  profileVersion: 1,
  capabilities: [
    { kind: "microphone", format: OPENHULI_PCM_FORMAT },
    { kind: "ping" },
  ],
};
let owner: { tenantId: string; userId: string },
  access: string,
  otherTenant: string;
type PairResult = Awaited<ReturnType<typeof pairOwnerDevice>>;
function req(method = "GET", body?: unknown, token = access) {
  return new Request("http://localhost:3000/api/devices", {
    method,
    headers: {
      origin: config.origin,
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function create(): Promise<PairResult> {
  const response = await pair(req("POST", profile));
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json();
}
const credential = (result: PairResult, purpose: "voice" | "mqtt") => {
  const value = result.credentials.find((item) => item.purpose === purpose);
  if (!value) throw new Error("Missing credential");
  return value;
};
beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { name: "Synthetic pairing home", slug: randomUUID() },
  });
  const user = await db.user.create({
    data: {
      email: config.ownerEmail,
      name: "Synthetic owner",
      passwordHash: "",
      status: "ACTIVE",
    },
  });
  const role = await db.role.create({
    data: {
      tenantId: tenant.id,
      name: "Owner",
      systemKey: "OWNER",
      scope: "TENANT",
    },
  });
  await db.membership.create({
    data: { tenantId: tenant.id, userId: user.id, roleId: role.id },
  });
  const sessionOwner = {
    tenantId: tenant.id,
    tenantName: tenant.name,
    userId: user.id,
    email: user.email,
    name: user.name,
  };
  owner = sessionOwner;
  const session = await db.refreshToken.create({
    data: {
      userId: owner.userId,
      tenantId: owner.tenantId,
      tokenHash: hashRefreshToken(newRefreshToken()),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  access = issueAccessToken(sessionOwner, session.id, config.secret);
  otherTenant = (
    await db.tenant.create({
      data: { name: "Other synthetic tenant", slug: randomUUID() },
    })
  ).id;
});
afterAll(async () => {
  if (owner) {
    await db.device.deleteMany({
      where: { tenantId: { in: [owner.tenantId, otherTenant] } },
    });
    await db.user.deleteMany({ where: { id: owner.userId } });
    await db.tenant.deleteMany({
      where: { id: { in: [owner.tenantId, otherTenant] } },
    });
  }
  await db.$disconnect();
  await globalThis.__corelyPrismaPool?.end();
  globalThis.__corelyPrisma = undefined;
  globalThis.__corelyPrismaPool = undefined;
});
describe("owner pairing HTTP and PostgreSQL", () => {
  it("rejects anonymous/spoofed owner and CSRF requests before pairing", async () => {
    expect((await pair(req("POST", profile, ""))).status).toBe(401);
    const csrf = req("POST", profile);
    csrf.headers.set("origin", "https://attacker.example.test");
    expect((await pair(csrf)).status).toBe(403);
    const spoof = req();
    spoof.headers.set("x-tenant-id", otherTenant);
    expect((await list(spoof)).status).toBe(403);
    expect(
      (
        await pair(
          req("POST", {
            ...profile,
            deviceId: "chosen-id",
            allowedTools: ["all"],
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("returns one-time scoped secrets and never returns hashes or plaintext on reads", async () => {
    const paired = await create();
    expect(paired.device.room).toBe("Kitchen");
    expect(paired.device.location?.latitude).toBe(52);
    expect(paired.mqtt.commands).toBe(
      `openhuli/v1/devices/${paired.device.id}/commands`,
    );
    const stored = await db.deviceCredential.findMany({
      where: { tenantId: owner.tenantId, deviceId: paired.device.id },
    });
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => /^[a-f0-9]{64}$/.test(row.secretHash))).toBe(
      true,
    );
    for (const secret of paired.credentials)
      expect(JSON.stringify(stored)).not.toContain(secret.token);
    const viewed = await detail(req(), params(paired.device.id));
    const serialized = await viewed.text();
    expect(serialized).not.toContain("secretHash");
    expect(serialized).not.toContain("ohd1.");
    expect((await list(req())).status).toBe(200);
    const mqtt = credential(paired, "mqtt");
    expect((await list(req("GET", undefined, mqtt.token))).status).toBe(401);
  });
  it("registers only owner-authorized capabilities with the right device purpose and identity", async () => {
    const paired = await create(),
      mqtt = credential(paired, "mqtt"),
      voice = credential(paired, "voice");
    const value = {
      version: 1,
      type: "device.manifest",
      messageId: "test",
      deviceId: paired.device.id,
      firmwareVersion: "test",
      capabilities: profile.capabilities,
    };
    expect((await manifest(req("POST", value, voice.token))).status).toBe(401);
    expect(
      (await manifest(req("POST", { ...value, deviceId: "other" }, mqtt.token)))
        .status,
    ).toBe(403);
    expect(
      (
        await manifest(
          req(
            "POST",
            {
              ...value,
              capabilities: [
                ...profile.capabilities,
                { kind: "display", maxTextLength: 64 },
              ],
            },
            mqtt.token,
          ),
        )
      ).status,
    ).toBe(403);
    expect((await manifest(req("POST", value, mqtt.token))).status).toBe(200);
    expect(
      JSON.parse(
        (await store.findDevice(owner.tenantId, paired.device.id))!
          .manifestJson,
      ).firmwareVersion,
    ).toBe("test");
  });
  it("isolates device reads, rotations, revocation and grant targets across tenants", async () => {
    const other = await pairOwnerDevice(
      profile,
      { tenantId: otherTenant, userId: "other-owner" },
      store,
    );
    expect((await detail(req(), params(other.device.id))).status).toBe(404);
    expect(
      (await deactivate(req("DELETE"), params(other.device.id))).status,
    ).toBe(404);
    expect(
      (
        await rotate(
          req("POST", {
            credentialId: credential(other, "voice").credentialId,
            purpose: "voice",
          }),
          params(other.device.id),
        )
      ).status,
    ).toBe(404);
    const own = await create();
    expect(
      (
        await grant(
          req("PUT", {
            toolId: "device.ping",
            targetDeviceIds: [other.device.id],
            expiresAt: new Date(Date.now() + 100000).toISOString(),
          }),
          params(own.device.id),
        )
      ).status,
    ).toBe(404);
    expect(
      await db.deviceToolGrant.count({
        where: { tenantId: owner.tenantId, deviceId: own.device.id },
      }),
    ).toBe(0);
  });
  it("allows only one concurrent credential rotation, invalidates old access, and survives repository restart", async () => {
    const paired = await create(),
      voice = credential(paired, "voice");
    const value = { credentialId: voice.credentialId, purpose: "voice" };
    const responses = await Promise.all([
      rotate(req("POST", value), params(paired.device.id)),
      rotate(req("POST", value), params(paired.device.id)),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const winning = responses.find((response) => response.status === 200)!;
    const next = await winning.json();
    await expect(
      authenticateScopedDevice(voice.token, "voice", store),
    ).rejects.toMatchObject({ status: 401 });
    const session = await authenticateScopedDevice(
      next.token,
      "voice",
      new DeviceAccessRepository(db),
    );
    expect(session.deviceId).toBe(paired.device.id);
    expect(
      (
        await revoke(req("DELETE"), {
          params: Promise.resolve({
            id: paired.device.id,
            credentialId: next.credentialId,
          }),
        })
      ).status,
    ).toBe(204);
    await expect(revalidateDeviceSession(session, store)).rejects.toMatchObject(
      { status: 401 },
    );
    expect(
      (
        await authenticateScopedDevice(
          credential(paired, "mqtt").token,
          "mqtt",
          store,
        )
      ).deviceId,
    ).toBe(paired.device.id);
  });
  it("enforces exact tool targets, expiry and revocation independently from manifest capabilities", async () => {
    const paired = await create(),
      session = await authenticateScopedDevice(
        credential(paired, "voice").token,
        "voice",
        store,
      );
    await expect(
      authorizePairedDeviceTool(
        session,
        "device.ping",
        paired.device.id,
        store,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const target = await create();
    const value = {
      toolId: "device.ping",
      targetDeviceIds: [target.device.id],
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    expect(
      (await grant(req("PUT", value), params(paired.device.id))).status,
    ).toBe(204);
    await authorizePairedDeviceTool(
      session,
      "device.ping",
      target.device.id,
      store,
    );
    await expect(
      authorizePairedDeviceTool(
        session,
        "device.ping",
        paired.device.id,
        store,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await revokeGrant(req("DELETE"), {
          params: Promise.resolve({
            id: paired.device.id,
            toolId: "device.ping",
          }),
        })
      ).status,
    ).toBe(204);
    await expect(
      authorizePairedDeviceTool(
        session,
        "device.ping",
        target.device.id,
        store,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await db.deviceCredential.updateMany({
      where: { tenantId: owner.tenantId, id: session.credentialId },
      data: { expiresAt: new Date(0) },
    });
    await expect(revalidateDeviceSession(session, store)).rejects.toMatchObject(
      { status: 401 },
    );
  });
  it("deactivates all transport credentials and grants without deleting history", async () => {
    const paired = await create(),
      mqtt = credential(paired, "mqtt");
    expect(
      (await deactivate(req("DELETE"), params(paired.device.id))).status,
    ).toBe(204);
    await expect(
      authenticateScopedDevice(mqtt.token, "mqtt", store),
    ).rejects.toMatchObject({ status: 401 });
    expect((await detail(req(), params(paired.device.id))).status).toBe(200);
    expect(
      (await store.findDevice(owner.tenantId, paired.device.id))?.status,
    ).toBe("revoked");
  });
  it("rejects credentials when their Tenant is disabled", async () => {
    const paired = await pairOwnerDevice(
      profile,
      { tenantId: otherTenant, userId: "other" },
      store,
    );
    const mqtt = credential(paired, "mqtt");
    await db.tenant.update({
      where: { id: otherTenant },
      data: { status: "DISABLED" },
    });
    try {
      await expect(
        authenticateScopedDevice(mqtt.token, "mqtt", store),
      ).rejects.toThrow();
    } finally {
      await db.tenant.update({
        where: { id: otherTenant },
        data: { status: "ACTIVE" },
      });
    }
  });
  it("returns explicit malformed and oversized body errors", async () => {
    const headers = {
      origin: config.origin,
      authorization: `Bearer ${access}`,
      "content-type": "application/json",
    };
    expect(
      (
        await pair(
          new Request("http://localhost:3000/api/devices", {
            method: "POST",
            headers,
            body: "not json",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await pair(
          new Request("http://localhost:3000/api/devices", {
            method: "POST",
            headers,
            body: JSON.stringify({ name: "x".repeat(20000) }),
          }),
        )
      ).status,
    ).toBe(400);
  });
});
