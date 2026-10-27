import { z } from "zod";
import { parseOpenHuliJson, OPENHULI_MAX_JSON_BYTES } from "@corely/contracts";
import {
  DeviceAccessError,
  type OwnerDeviceContext,
} from "@corely/modules-devices";
import { authenticateOwner } from "./auth";
import { problemFromError } from "./problem-details";

export async function deviceResponse(
  work: () => Promise<Response>,
): Promise<Response> {
  try {
    const response = await work();
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    const response = problemFromError(error);
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
export function ownerDeviceResponse(
  request: Request,
  work: (owner: OwnerDeviceContext) => Promise<Response>,
) {
  return deviceResponse(async () => {
    const owner = await authenticateOwner(request);
    return work({ tenantId: owner.tenantId, userId: owner.userId });
  });
}
export function deviceBearer(request: Request): string {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ") || header.length > 1100)
    throw new DeviceAccessError(401, "Device credential required");
  return header.slice(7);
}
export async function readDeviceJson(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") || "",
    )
  )
    throw new DeviceAccessError(400, "JSON request body required");
  const reader = request.body?.getReader();
  if (!reader) throw new DeviceAccessError(400, "JSON request body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > OPENHULI_MAX_JSON_BYTES) {
        await reader.cancel();
        throw new DeviceAccessError(400, "JSON request body is too large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return parseOpenHuliJson(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      z.unknown(),
    );
  } catch (error) {
    if (error instanceof DeviceAccessError) throw error;
    throw new DeviceAccessError(400, "Invalid JSON request body");
  } finally {
    reader.releaseLock();
  }
}
