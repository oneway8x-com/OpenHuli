import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { DeviceAccessReferenceSchema } from "@corely/contracts";
import { DeviceAccessError } from "./device-access.errors";

export const hashDeviceSecret = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
export function createDeviceSecret(tenantId: string, deviceId: string) {
  const reference = DeviceAccessReferenceSchema.parse({
    tenantId,
    deviceId,
    credentialId: randomUUID(),
  });
  const secret = randomBytes(32).toString("base64url");
  const header = Buffer.from(JSON.stringify(reference)).toString("base64url");
  return {
    ...reference,
    token: `ohd1.${header}.${secret}`,
    secretHash: hashDeviceSecret(secret),
  };
}
export function parseDeviceSecret(token: string) {
  if (token.length > 1024)
    throw new DeviceAccessError(401, "Invalid device credential");
  const parts = token.split(".");
  const [version, header, secret] = parts;
  if (
    parts.length !== 3 ||
    version !== "ohd1" ||
    !header ||
    !secret ||
    !/^[A-Za-z0-9_-]{43}$/.test(secret)
  )
    throw new DeviceAccessError(401, "Invalid device credential");
  try {
    const bytes = Buffer.from(header, "base64url");
    if (
      bytes.toString("base64url") !== header ||
      Buffer.from(secret, "base64url").toString("base64url") !== secret
    )
      throw new Error("Non-canonical credential");
    const reference = DeviceAccessReferenceSchema.parse(
      JSON.parse(bytes.toString("utf8")),
    );
    return { ...reference, secretHash: hashDeviceSecret(secret) };
  } catch {
    throw new DeviceAccessError(401, "Invalid device credential");
  }
}
export function matchesDeviceSecret(stored: string, supplied: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(stored) || !/^[a-f0-9]{64}$/.test(supplied))
    return false;
  return timingSafeEqual(
    Buffer.from(stored, "hex"),
    Buffer.from(supplied, "hex"),
  );
}
