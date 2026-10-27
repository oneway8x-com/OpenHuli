import {
  RequestOwnerCodeSchema,
  VerifyOwnerCodeSchema,
} from "@corely/contracts";
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  IdentityError,
  readAuthConfig,
  requestOwnerCode,
  verifyOwnerCode,
  resolveOwnerSession,
  refreshOwnerSession,
  logoutOwner,
  verifyAccessToken,
  type AuthConfig,
  type IssuedSession,
} from "@corely/modules-identity";
import { getIdentityStore } from "./identity-runtime";
import { problemFromError } from "./problem-details";

export const ACCESS_COOKIE = "openhuli_access";
export const REFRESH_COOKIE = "openhuli_refresh";

export function readCookie(request: Request, name: string): string | null {
  const cookie = (request.headers.get("cookie") || "")
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return null;
  }
}

export function requireSameOrigin(
  request: Request,
  config = readAuthConfig(),
): void {
  if (request.headers.get("origin") !== config.origin)
    throw new IdentityError(403, "Request origin is not allowed");
}

export async function authenticateOwner(request: Request) {
  const config = readAuthConfig();
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;
  const access = authorization ? bearer : readCookie(request, ACCESS_COOKIE);
  const claims = access ? verifyAccessToken(access, config.secret) : null;
  if (!claims) throw new IdentityError(401, "Sign in required");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    (!bearer || request.headers.has("origin"))
  )
    requireSameOrigin(request, config);
  const owner = await resolveOwnerSession(claims, config, getIdentityStore());
  const requestedTenant = request.headers.get("x-tenant-id");
  if (requestedTenant && requestedTenant !== owner.tenantId)
    throw new IdentityError(403, "Tenant selection is not permitted");
  return owner;
}

function setCookie(
  response: Response,
  name: string,
  value: string,
  maxAge: number,
  path: string,
  config: AuthConfig,
) {
  response.headers.append(
    "set-cookie",
    `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=${maxAge}${config.secureCookies ? "; Secure" : ""}`,
  );
}
function sessionResponse(session: IssuedSession, config: AuthConfig) {
  const response = Response.json(session.owner, {
    headers: { "cache-control": "no-store" },
  });
  setCookie(
    response,
    ACCESS_COOKIE,
    session.accessToken,
    ACCESS_TTL_SECONDS,
    "/",
    config,
  );
  setCookie(
    response,
    REFRESH_COOKIE,
    session.refreshToken,
    REFRESH_TTL_SECONDS,
    "/api/auth",
    config,
  );
  return response;
}
async function respond(work: () => Promise<Response>) {
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
async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new IdentityError(400, "JSON request body required");
  try {
    return await request.json();
  } catch {
    throw new IdentityError(400, "Invalid JSON request body");
  }
}
async function deliverCode(
  email: string,
  code: string,
  config: AuthConfig,
): Promise<void> {
  if (config.development) {
    console.log(`[OpenHuli development OTP] ${email}: ${code}`);
    return;
  }
  if (!config.emailApiKey || !config.emailFrom)
    throw new IdentityError(503, "Email delivery is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.emailApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: email,
      subject: "Your OpenHuli verification code",
      text: `Your verification code is ${code}. It expires in 15 minutes.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new IdentityError(503, "Could not send a verification code");
}

export function handleRequestCode(request: Request): Promise<Response> {
  return respond(async () => {
    const config = readAuthConfig();
    requireSameOrigin(request, config);
    const input = RequestOwnerCodeSchema.parse(await jsonBody(request));
    const result = await requestOwnerCode(
      input.email,
      config,
      getIdentityStore(),
      (email, code) => deliverCode(email, code, config),
    );
    return Response.json(result);
  });
}
export function handleVerifyCode(request: Request): Promise<Response> {
  return respond(async () => {
    const config = readAuthConfig();
    requireSameOrigin(request, config);
    const input = VerifyOwnerCodeSchema.parse(await jsonBody(request));
    return sessionResponse(
      await verifyOwnerCode(
        input.email,
        input.code,
        config,
        getIdentityStore(),
      ),
      config,
    );
  });
}
export function handleGetMe(request: Request): Promise<Response> {
  return respond(async () => Response.json(await authenticateOwner(request)));
}
export function handleRefresh(request: Request): Promise<Response> {
  return respond(async () => {
    const config = readAuthConfig();
    requireSameOrigin(request, config);
    const refresh = readCookie(request, REFRESH_COOKIE);
    if (!refresh) throw new IdentityError(401, "Sign in required");
    return sessionResponse(
      await refreshOwnerSession(refresh, config, getIdentityStore()),
      config,
    );
  });
}
export function handleLogout(request: Request): Promise<Response> {
  return respond(async () => {
    const config = readAuthConfig();
    requireSameOrigin(request, config);
    const refresh = readCookie(request, REFRESH_COOKIE);
    if (refresh) await logoutOwner(refresh, getIdentityStore());
    const response = new Response(null, { status: 204 });
    setCookie(response, ACCESS_COOKIE, "", 0, "/", config);
    setCookie(response, REFRESH_COOKIE, "", 0, "/api/auth", config);
    return response;
  });
}
