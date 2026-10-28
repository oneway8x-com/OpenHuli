import { ManagementCommandSchema, OpenHuliIdSchema } from "@corely/contracts";
import { authenticateOwner, ACCESS_COOKIE, readCookie } from "./auth";
import { deviceResponse, readDeviceJson } from "./device-http";

export function managementResponse(request: Request) {
  return deviceResponse(async () => {
    await authenticateOwner(request);
    const endpoint = new URL(
      process.env.OPENHULI_RUNTIME_HTTP_URL ?? "http://127.0.0.1:3200",
    );
    if (
      !(
        endpoint.protocol === "https:" ||
        (endpoint.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
      ) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/"
    )
      throw new Error("Invalid runtime endpoint");
    endpoint.pathname = "/management";
    const query = new URL(request.url).searchParams;
    for (const key of ["device", "execution", "request"]) {
      const value = query.get(key);
      if (value) endpoint.searchParams.set(key, OpenHuliIdSchema.parse(value));
    }
    const bearer = request.headers.get("authorization");
    const token = bearer?.startsWith("Bearer ")
      ? bearer.slice(7)
      : readCookie(request, ACCESS_COOKIE);
    const body =
      request.method === "POST"
        ? JSON.stringify(
            ManagementCommandSchema.parse(await readDeviceJson(request)),
          )
        : undefined;
    const result = await fetch(endpoint, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body ? { body } : {}),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]),
    });
    if (!result.ok) {
      await result.body?.cancel();
      return Response.json(
        {
          error:
            "Device request unavailable. Check your session, capabilities and runtime configuration.",
        },
        { status: result.status },
      );
    }
    return new Response(result.body, {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  });
}
