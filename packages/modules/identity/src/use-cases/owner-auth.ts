import { randomInt } from "node:crypto";
import type { OwnerSession } from "@corely/contracts";
import type { AuthConfig } from "../identity.config";
import { IdentityError } from "../identity.errors";
import type { IdentityRepository } from "../identity.repository";
import {
  hashOwnerCode,
  hashRefreshToken,
  issueAccessToken,
  newRefreshToken,
  REFRESH_TTL_SECONDS,
  type AccessClaims,
} from "../identity.tokens";

export type IdentityStore = Pick<
  IdentityRepository,
  | "findOwner"
  | "reserveCode"
  | "consumeCode"
  | "createSession"
  | "getSession"
  | "findRefreshSession"
  | "rotateSession"
  | "revokeSession"
  | "bootstrapOwner"
>;
export type DeliverOwnerCode = (email: string, code: string) => Promise<void>;
export interface IssuedSession {
  owner: OwnerSession;
  accessToken: string;
  refreshToken: string;
}

export async function requestOwnerCode(
  email: string,
  config: AuthConfig,
  store: IdentityStore,
  deliver: DeliverOwnerCode,
) {
  const result = {
    message:
      "If this is the configured owner, a verification code has been sent.",
    canProceed: true,
    cooldownSeconds: 60,
  };
  if (email !== config.ownerEmail) return result;
  const owner = await store.findOwner(email);
  if (!owner) return result;
  const code = String(randomInt(100_000, 1_000_000));
  if (
    await store.reserveCode(
      owner,
      hashOwnerCode(email, code, config.secret),
      new Date(),
    )
  )
    await deliver(email, code);
  return result;
}

export async function verifyOwnerCode(
  email: string,
  code: string,
  config: AuthConfig,
  store: IdentityStore,
): Promise<IssuedSession> {
  if (email !== config.ownerEmail)
    throw new IdentityError(400, "Invalid or expired verification code");
  const owner = await store.findOwner(email);
  if (
    !owner ||
    !(await store.consumeCode(
      owner,
      hashOwnerCode(email, code, config.secret),
      new Date(),
    ))
  )
    throw new IdentityError(400, "Invalid or expired verification code");
  const refreshToken = newRefreshToken();
  const session = await store.createSession(
    owner,
    hashRefreshToken(refreshToken),
    new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  );
  return {
    owner,
    accessToken: issueAccessToken(owner, session.id, config.secret),
    refreshToken,
  };
}

export async function resolveOwnerSession(
  claims: AccessClaims,
  config: AuthConfig,
  store: IdentityStore,
): Promise<OwnerSession> {
  const session = await store.getSession(claims.sid);
  if (
    !session ||
    session.expiresAt.getTime() <= Date.now() ||
    session.userId !== claims.sub ||
    session.tenantId !== claims.tenantId ||
    claims.email !== config.ownerEmail
  )
    throw new IdentityError(401, "Sign in required");
  const owner = await store.findOwner(config.ownerEmail, claims.tenantId);
  if (!owner || owner.userId !== claims.sub)
    throw new IdentityError(403, "Active owner membership required");
  return owner;
}

export async function refreshOwnerSession(
  rawToken: string,
  config: AuthConfig,
  store: IdentityStore,
): Promise<IssuedSession> {
  const hash = hashRefreshToken(rawToken);
  const session = await store.findRefreshSession(hash);
  if (!session?.tenantId || session.expiresAt.getTime() <= Date.now())
    throw new IdentityError(401, "Sign in required");
  const owner = await store.findOwner(config.ownerEmail, session.tenantId);
  if (!owner || owner.userId !== session.userId)
    throw new IdentityError(403, "Active owner membership required");
  const refreshToken = newRefreshToken();
  if (
    !(await store.rotateSession(
      session.id,
      hash,
      hashRefreshToken(refreshToken),
    ))
  )
    throw new IdentityError(401, "Refresh session already used");
  return {
    owner,
    accessToken: issueAccessToken(owner, session.id, config.secret),
    refreshToken,
  };
}

export async function logoutOwner(
  rawToken: string,
  store: IdentityStore,
): Promise<void> {
  await store.revokeSession(hashRefreshToken(rawToken));
}
export async function bootstrapOwner(
  config: AuthConfig,
  store: IdentityStore,
): Promise<OwnerSession> {
  return store.bootstrapOwner(config.ownerEmail);
}

export function authorizeOwnerUpload(
  tenantId: string,
  pathname: string,
  prefix: string,
): string {
  const namespace = [tenantId, prefix].filter(Boolean).join("/");
  if (
    !pathname.startsWith(`${namespace}/`) ||
    pathname.includes("..") ||
    pathname.includes("%") ||
    pathname.includes("\\")
  )
    throw new IdentityError(
      403,
      "Upload pathname is outside the owner tenant namespace",
    );
  return pathname;
}
