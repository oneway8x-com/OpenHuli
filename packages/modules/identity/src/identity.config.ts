import { z } from "zod";

export const DEVELOPMENT_SECRET =
  "openhuli-development-only-secret-change-before-deploy";
export interface AuthConfig {
  secret: string;
  ownerEmail: string;
  origin: string;
  development: boolean;
  secureCookies: boolean;
  emailFrom: string;
  emailApiKey: string;
}

export function readAuthConfig(
  env: Record<string, string | undefined> = process.env,
): AuthConfig {
  const development = env.NODE_ENV === "development";
  const secret = env.JWT_SECRET || (development ? DEVELOPMENT_SECRET : "");
  const ownerEmail = (env.OWNER_EMAIL || "").trim().toLowerCase();
  const appUrl = env.APP_URL || (development ? "http://localhost:3000" : "");
  if (
    secret.trim().length < 32 ||
    (!development &&
      [DEVELOPMENT_SECRET, "dev-secret-change-in-prod"].includes(secret))
  ) {
    throw new Error(
      "JWT_SECRET must be a non-development secret of at least 32 characters outside development",
    );
  }
  if (!z.string().email().safeParse(ownerEmail).success)
    throw new Error("OWNER_EMAIL must be a valid configured owner email");
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    throw new Error("APP_URL must be an absolute HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "APP_URL must be an absolute HTTP(S) origin without credentials or a path",
    );
  }
  if (
    !development &&
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("APP_URL must use HTTPS outside loopback development");
  }
  const emailFrom = env.EMAIL_FROM || "";
  const emailApiKey = env.RESEND_API_KEY || "";
  if (
    env.NODE_ENV === "production" &&
    (!emailApiKey || !z.string().email().safeParse(emailFrom).success)
  ) {
    throw new Error(
      "Production requires RESEND_API_KEY and a valid EMAIL_FROM for owner login",
    );
  }
  return {
    secret,
    ownerEmail,
    origin: url.origin,
    development,
    secureCookies: !development,
    emailFrom,
    emailApiKey,
  };
}
