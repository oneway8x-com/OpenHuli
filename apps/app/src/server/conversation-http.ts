import { ConsoleCommandSchema, OpenHuliIdSchema } from "@corely/contracts";
import { authenticateOwner, ACCESS_COOKIE, readCookie } from "./auth";
import { readDeviceJson } from "./device-http";
import { problemFromError } from "./problem-details";

/** Same-origin BFF: owner access remains HttpOnly; runtime receives it only over the server hop. */
export async function consoleResponse(request: Request, events = false) {
  try {
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
    endpoint.pathname = events ? "/console/events" : "/console";
    const id = new URL(request.url).searchParams.get("id");
    if (id) endpoint.searchParams.set("id", OpenHuliIdSchema.parse(id));
    if (events && !id) throw new Error("Conversation required");
    const bearer = request.headers.get("authorization");
    const token = bearer?.startsWith("Bearer ")
      ? bearer.slice(7)
      : readCookie(request, ACCESS_COOKIE);
    const body =
      request.method === "POST"
        ? JSON.stringify(
            ConsoleCommandSchema.parse(await readDeviceJson(request)),
          )
        : undefined;
    const upstream = await fetch(endpoint, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body ? { body } : {}),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(events ? 300000 : 12000),
      ]),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return Response.json(
        {
          error:
            upstream.status === 409
              ? "This conversation cannot accept a new turn. Start a new conversation."
              : "Conversation request unavailable. Check your session and runtime configuration.",
        },
        { status: upstream.status, headers: { "cache-control": "no-store" } },
      );
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": events ? "text/event-stream" : "application/json",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    const result = problemFromError(error);
    result.headers.set("cache-control", "no-store");
    return result;
  }
}
