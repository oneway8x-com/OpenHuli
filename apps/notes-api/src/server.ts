import { createServer, type IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { OpenHuliJsonObjectSchema, parseOpenHuliJson } from "@corely/contracts";
import {
  createNote,
  findNote,
  NoteConflict,
  type NotesStore,
} from "@corely/modules-notes";
import type { NotesApiConfig } from "./config";
async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 16384) throw new Error("Invalid body");
    chunks.push(bytes);
  }
  return parseOpenHuliJson(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    OpenHuliJsonObjectSchema,
  );
}
export function createNotesServer(config: NotesApiConfig, store: NotesStore) {
  const expected = Buffer.from(`Bearer ${config.NOTES_API_TOKEN}`);
  const server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(body));
    };
    const provided = Buffer.from(request.headers.authorization ?? "");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      send(401, { error: "Unauthorized" });
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      send(200, { ready: true });
      return;
    }
    if (
      request.url !== "/notes" ||
      !["GET", "POST"].includes(request.method ?? "")
    ) {
      send(404, { error: "Not found" });
      return;
    }
    const context = {
      tenantId: request.headers["x-tenant-id"],
      idempotencyKey: request.headers["idempotency-key"],
    };
    try {
      if (request.method === "GET") {
        const note = findNote(context, store);
        send(note ? 200 : 404, note ? { note } : { error: "Not found" });
      } else {
        if (
          !(request.headers["content-type"] ?? "").match(
            /^application\/json(?:\s*;|$)/i,
          ) ||
          request.headers["content-encoding"]
        ) {
          send(400, { error: "Invalid body" });
          return;
        }
        let body: unknown;
        try {
          body = await readJson(request);
        } catch {
          send(400, { error: "Invalid body" });
          return;
        }
        send(201, { note: createNote(body, context, store) });
      }
    } catch (error) {
      send(
        error instanceof NoteConflict
          ? 409
          : error instanceof z.ZodError
            ? 400
            : 500,
        {
          error:
            error instanceof NoteConflict
              ? "Idempotency conflict"
              : "Request failed",
        },
      );
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 32;
  return server;
}
