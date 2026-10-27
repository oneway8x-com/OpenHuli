import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { OwnerSession } from "@corely/contracts";

export const ACCESS_TTL_SECONDS = 60 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const ClaimsSchema = z
  .object({
    iss: z.literal("openhuli"),
    aud: z.literal("openhuli-console"),
    sub: z.string().min(1),
    email: z.string().email(),
    tenantId: z.string().min(1),
    sid: z.string().min(1),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict();
export type AccessClaims = z.infer<typeof ClaimsSchema>;
export const hashRefreshToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const newRefreshToken = () => randomBytes(40).toString("hex");
export const hashOwnerCode = (email: string, code: string, secret: string) =>
  createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");

export function issueAccessToken(
  owner: OwnerSession,
  sessionId: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      iss: "openhuli",
      aud: "openhuli-console",
      sub: owner.userId,
      email: owner.email,
      tenantId: owner.tenantId,
      sid: sessionId,
      iat: now,
      exp: now + ACCESS_TTL_SECONDS,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyAccessToken(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): AccessClaims | null {
  try {
    if (token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts as [string, string, string];
    const parsedHeader = JSON.parse(
      Buffer.from(header, "base64url").toString(),
    ) as { alg?: unknown; typ?: unknown };
    if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") return null;
    const expected = createHmac("sha256", secret)
      .update(`${header}.${body}`)
      .digest();
    const supplied = Buffer.from(signature, "base64url");
    if (
      supplied.length !== expected.length ||
      supplied.toString("base64url") !== signature ||
      !timingSafeEqual(expected, supplied)
    )
      return null;
    const parsed = ClaimsSchema.safeParse(
      JSON.parse(Buffer.from(body, "base64url").toString()),
    );
    if (!parsed.success) return null;
    const claims = parsed.data;
    if (
      claims.exp <= now ||
      claims.iat > now + 30 ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > ACCESS_TTL_SECONDS
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}
