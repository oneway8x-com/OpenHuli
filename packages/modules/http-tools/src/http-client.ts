import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { OpenHuliJsonObjectSchema, parseOpenHuliJson } from "@corely/contracts";

export class HttpToolError extends Error {
  constructor(
    readonly code:
      | "destination_denied"
      | "unavailable"
      | "invalid_response"
      | "pending"
      | "http_failed",
  ) {
    super(`HTTP tool: ${code}`);
    this.name = "HttpToolError";
  }
}
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("3fff::", 20, "ipv6");
blocked.addSubnet("3ffe::", 16, "ipv6");
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}
export interface Destination {
  readonly url: string;
  readonly privateDemo?: boolean;
}
export function validateDestination(destination: Destination): URL {
  let url: URL;
  try {
    url = new URL(destination.url);
  } catch {
    throw new HttpToolError("destination_denied");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const exactLoopback = ["127.0.0.1", "::1"].includes(host);
  if (
    url.username ||
    url.password ||
    url.hash ||
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol !== "https:" &&
      !(destination.privateDemo && exactLoopback)) ||
    (destination.privateDemo && (!exactLoopback || url.search)) ||
    (isIP(host) &&
      !isPublicAddress(host) &&
      !(destination.privateDemo && exactLoopback))
  )
    throw new HttpToolError("destination_denied");
  return url;
}
export type Resolver = (
  hostname: string,
) => Promise<readonly { address: string; family: number }[]>;
export interface JsonRequest {
  destination: Destination;
  method: "GET" | "POST";
  headers?: Readonly<Record<string, string>>;
  body?: unknown;
  signal: AbortSignal;
  timeoutMs?: number;
  expectedStatus: 200 | 201;
}
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        abort = () => reject(new HttpToolError("unavailable"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
/** No redirects, proxy environment, cookie jar or automatic retries. DNS answers are checked then pinned. */
export class JsonHttpClient {
  constructor(
    private readonly resolve: Resolver = (hostname) =>
      lookup(hostname, { all: true }),
  ) {}
  async send(input: JsonRequest) {
    const destination = Object.freeze({ ...input.destination });
    const url = validateDestination(destination),
      hostname = url.hostname.replace(/^\[|\]$/g, "");
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(input.timeoutMs ?? 5000),
    ]);
    try {
      const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await abortable(this.resolve(hostname), signal);
      if (
        !addresses.length ||
        addresses.length > 32 ||
        addresses.some(
          ({ address, family }) =>
            !isIP(address) ||
            isIP(address) !== family ||
            (!isPublicAddress(address) && !destination.privateDemo),
        )
      )
        throw new HttpToolError("destination_denied");
      const pinned = addresses[0];
      if (!pinned) throw new HttpToolError("destination_denied");
      const body =
        input.body === undefined
          ? undefined
          : JSON.stringify(OpenHuliJsonObjectSchema.parse(input.body));
      if (body !== undefined && Buffer.byteLength(body) > 16384)
        throw new HttpToolError("invalid_response");
      if (input.method === "GET" && body !== undefined)
        throw new HttpToolError("destination_denied");
      return await new Promise<
        ReturnType<typeof OpenHuliJsonObjectSchema.parse>
      >((resolve, reject) => {
        if (signal.aborted) {
          reject(new HttpToolError("unavailable"));
          return;
        }
        const request = url.protocol === "https:" ? httpsRequest : httpRequest;
        const req = request(
          {
            hostname: pinned.address,
            family: pinned.family,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            servername: hostname,
            rejectUnauthorized: true,
            path: url.pathname + url.search,
            method: input.method,
            signal,
            agent: false,
            headers: {
              ...input.headers,
              Host: url.host,
              Accept: "application/json",
              "Accept-Encoding": "identity",
              ...(body === undefined
                ? {}
                : {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                  }),
            },
          },
          (response) => {
            const fail = (code: HttpToolError["code"]) => {
              reject(new HttpToolError(code));
              response.destroy();
            };
            if (response.statusCode === 202) {
              fail("pending");
              return;
            }
            if (response.statusCode !== input.expectedStatus) {
              fail("http_failed");
              return;
            }
            if (
              !(response.headers["content-type"] ?? "")
                .toLowerCase()
                .match(/^application\/json(?:\s*;|$)/) ||
              (response.headers["content-encoding"] &&
                response.headers["content-encoding"] !== "identity")
            ) {
              fail("invalid_response");
              return;
            }
            let size = 0;
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > 16384) fail("invalid_response");
              else chunks.push(chunk);
            });
            response.on("error", () =>
              reject(new HttpToolError("unavailable")),
            );
            response.on("end", () => {
              try {
                resolve(
                  parseOpenHuliJson(
                    new TextDecoder("utf-8", { fatal: true }).decode(
                      Buffer.concat(chunks),
                    ),
                    OpenHuliJsonObjectSchema,
                  ),
                );
              } catch {
                reject(new HttpToolError("invalid_response"));
              }
            });
          },
        );
        req.on("error", () => reject(new HttpToolError("unavailable")));
        req.end(body);
      });
    } catch (error) {
      throw error instanceof HttpToolError
        ? error
        : new HttpToolError("unavailable");
    }
  }
}
