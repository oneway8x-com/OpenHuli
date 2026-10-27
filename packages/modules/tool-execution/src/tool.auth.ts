import { z } from "zod";
import { OpenHuliIdSchema } from "@corely/contracts";
import {
  authenticateScopedDevice,
  authorizePairedDeviceTool,
  revalidateDeviceSession,
} from "@corely/modules-devices";
import {
  resolveOwnerSession,
  verifyAccessToken,
} from "@corely/modules-identity";
import type {
  Actor,
  ExecutionRecord,
  RegisteredTool,
  ToolAuthentication,
  ToolDependencies,
} from "./tool.types";

export const ActorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("owner"),
      tenantId: OpenHuliIdSchema,
      userId: OpenHuliIdSchema,
      sessionId: OpenHuliIdSchema,
      accessExpiresAt: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("device"),
      tenantId: OpenHuliIdSchema,
      deviceId: OpenHuliIdSchema,
      credentialId: OpenHuliIdSchema,
      purpose: z.enum(["voice", "mqtt"]),
    })
    .strict(),
]);
export async function authenticate(
  auth: ToolAuthentication,
  deps: ToolDependencies,
): Promise<Actor> {
  if (auth.kind === "owner") {
    const claims = verifyAccessToken(auth.token, deps.auth.secret);
    if (!claims) throw new Error("Owner authentication required");
    const owner = await resolveOwnerSession(claims, deps.auth, deps.identity);
    return {
      kind: "owner",
      tenantId: owner.tenantId,
      userId: owner.userId,
      sessionId: claims.sid,
      accessExpiresAt: claims.exp * 1000,
    };
  }
  // Only purpose-scoped voice credentials may originate conversation tool calls.
  return {
    kind: "device",
    ...(await authenticateScopedDevice(auth.token, "voice", deps.devices)),
  };
}
export async function revalidateActor(actor: Actor, deps: ToolDependencies) {
  if (actor.kind === "device")
    return revalidateDeviceSession(actor, deps.devices);
  const [session, owner] = await Promise.all([
    deps.identity.getSession(actor.sessionId),
    deps.identity.findOwner(deps.auth.ownerEmail, actor.tenantId),
  ]);
  if (
    !session ||
    !owner ||
    session.tenantId !== actor.tenantId ||
    session.userId !== actor.userId ||
    owner.userId !== actor.userId ||
    session.expiresAt <= new Date() ||
    actor.accessExpiresAt <= Date.now()
  )
    throw new Error("Originating owner session is no longer active");
}
export async function authorizeScope(
  actor: Actor,
  tool: RegisteredTool,
  target: string | null,
  deps: ToolDependencies,
) {
  await revalidateActor(actor, deps);
  if (target !== null) {
    const device = await deps.devices.findDevice(actor.tenantId, target);
    if (!device || device.status !== "active")
      throw new Error("Target device not found");
  }
  if (actor.kind === "device")
    await authorizePairedDeviceTool(actor, tool.id, target, deps.devices);
}
export const scopeKey = (
  actorDeviceId: string | null,
  targetDeviceId: string | null,
) => JSON.stringify([actorDeviceId, targetDeviceId]);
export async function hasPreauthorization(
  actor: Actor,
  tool: RegisteredTool,
  target: string | null,
  deps: ToolDependencies,
) {
  if (
    tool.effect !== "write" ||
    tool.risk !== "low" ||
    tool.approval === "required"
  )
    return false;
  const owner = await deps.identity.findOwner(
    deps.auth.ownerEmail,
    actor.tenantId,
  );
  if (!owner || (actor.kind === "owner" && owner.userId !== actor.userId))
    return false;
  return deps.store.preauthorization(
    actor.tenantId,
    owner.userId,
    tool.id,
    tool.policyHash,
    scopeKey(actor.kind === "device" ? actor.deviceId : null, target),
    new Date(),
  );
}
export async function requireContext(
  actor: Actor,
  runId: string,
  turnId: string,
  deps: ToolDependencies,
) {
  const context = await deps.store.context(
    actor.tenantId,
    runId,
    turnId,
    new Date(),
  );
  if (
    !context ||
    (actor.kind === "device" && context.deviceId !== actor.deviceId)
  )
    throw new Error("Active committed conversation turn not found");
  return context;
}
export function requireVisibility(actor: Actor, record: ExecutionRecord) {
  const source = ActorSchema.parse(JSON.parse(record.actorJson ?? "null"));
  if (
    actor.tenantId !== record.tenantId ||
    (actor.kind === "device" &&
      (source.kind !== "device" || actor.deviceId !== source.deviceId))
  )
    throw new Error("Execution not found");
  return source;
}
