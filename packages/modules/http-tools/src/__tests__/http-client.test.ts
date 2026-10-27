import { createServer, type Server, type RequestListener } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JsonHttpClient,
  isPublicAddress,
  validateDestination,
} from "../http-client";
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
async function fixture(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error();
  return `http://127.0.0.1:${address.port}/notes`;
}
const send = (url: string, privateDemo = true) =>
  new JsonHttpClient().send({
    destination: { url, privateDemo },
    method: "GET",
    expectedStatus: 200,
    signal: new AbortController().signal,
  });
describe("fixed destination JSON HTTP transport", () => {
  it.each([
    "0.0.0.0",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "100.100.100.200",
    "169.254.169.254",
    "192.0.0.192",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::1",
  ])("denies special address %s", (address) =>
    expect(isPublicAddress(address)).toBe(false),
  );
  it("permits public unicast and denies unsafe destinations and private exceptions that are not exact loopback", () => {
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    for (const url of [
      "http://example.com/",
      "https://user:password@example.com/",
      "https://example.com/#secret",
      "file:///tmp/file",
      "https://127.0.0.1/",
    ])
      expect(() => validateDestination({ url })).toThrow("destination_denied");
    expect(() =>
      validateDestination({
        url: "http://localhost:3300/notes",
        privateDemo: true,
      }),
    ).toThrow();
    expect(() =>
      validateDestination({ url: "http://10.0.0.1/notes", privateDemo: true }),
    ).toThrow();
    expect(() =>
      validateDestination({
        url: "http://127.0.0.1/notes?url=other",
        privateDemo: true,
      }),
    ).toThrow();
  });
  it("rejects every private/mixed DNS answer before making a connection, including rebinding", async () => {
    const resolver = vi.fn().mockResolvedValue([
      { address: "1.1.1.1", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const client = new JsonHttpClient(resolver);
    await expect(
      client.send({
        destination: { url: "https://example.test/" },
        method: "GET",
        expectedStatus: 200,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("destination_denied");
    expect(resolver).toHaveBeenCalledTimes(1);
  });
  it("retains the checked destination policy while DNS is pending", async () => {
    let finish!: (addresses: { address: string; family: number }[]) => void;
    const client = new JsonHttpClient(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const destination = { url: "https://example.test/", privateDemo: false };
    const pending = client.send({
      destination,
      method: "GET",
      expectedStatus: 200,
      signal: new AbortController().signal,
    });
    destination.privateDemo = true;
    finish([{ address: "127.0.0.1", family: 4 }]);
    await expect(pending).rejects.toThrow("destination_denied");
  });
  it("supports only the explicitly selected local demo destination", async () => {
    let count = 0;
    const url = await fixture((_, response) => {
      count++;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
    });
    await expect(send(url, false)).rejects.toThrow("destination_denied");
    expect(await send(url)).toEqual({ ok: true });
    expect(count).toBe(1);
  });
  it.each([301, 302, 307, 308, 202, 500])(
    "does not follow or report completion for status %s",
    async (status) => {
      let calls = 0;
      const url = await fixture((_, response) => {
        calls++;
        response.writeHead(status, {
          "Content-Type": "application/json",
          Location: "http://169.254.169.254/secret",
        });
        response.end('{"token":"private-provider-secret"}');
      });
      await expect(send(url)).rejects.toThrow(
        status === 202 ? "pending" : "http_failed",
      );
      expect(calls).toBe(1);
    },
  );
  it.each(["oversized", "invalid", "compression", "content-type"])(
    "bounds/rejects %s responses",
    async (kind) => {
      const url = await fixture((_, response) => {
        response.writeHead(200, {
          "Content-Type":
            kind === "content-type" ? "text/plain" : "application/json",
          ...(kind === "compression" ? { "Content-Encoding": "gzip" } : {}),
        });
        response.end(
          kind === "oversized"
            ? '{"x":"' + "x".repeat(17000) + '"}'
            : "not JSON",
        );
      });
      await expect(send(url)).rejects.toThrow("invalid_response");
    },
  );
  it("aborts DNS and sockets on deadlines without exposing provider diagnostics", async () => {
    const client = new JsonHttpClient(async () => new Promise(() => {}));
    await expect(
      client.send({
        destination: { url: "https://example.test/" },
        method: "GET",
        expectedStatus: 200,
        signal: AbortSignal.timeout(10),
      }),
    ).rejects.toThrow("unavailable");
    const url = await fixture(() => {});
    await expect(
      new JsonHttpClient().send({
        destination: { url, privateDemo: true },
        method: "GET",
        expectedStatus: 200,
        signal: new AbortController().signal,
        timeoutMs: 10,
      }),
    ).rejects.toThrow("unavailable");
  });
});
