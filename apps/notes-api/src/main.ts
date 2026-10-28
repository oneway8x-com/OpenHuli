import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { NotesRepository } from "@corely/modules-notes";
import { readNotesApiConfig } from "./config";
import { createNotesServer } from "./server";
try {
  const config = readNotesApiConfig(process.env);
  mkdirSync(dirname(config.NOTES_API_DATABASE), { recursive: true });
  const store = new NotesRepository(config.NOTES_API_DATABASE),
    server = createNotesServer(config, store);
  server.on("error", () => {
    console.error("Notes API failed to start");
    store.close();
    process.exitCode = 1;
  });
  server.listen(config.NOTES_API_PORT, config.NOTES_API_HOST, () => {
    const address = server.address();
    console.info(
      `Notes API listening on loopback port ${address && typeof address !== "string" ? address.port : config.NOTES_API_PORT}`,
    );
  });
  const stop = () => {
    server.close(() => {
      store.close();
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
    });
    server.closeIdleConnections();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch {
  console.error("Notes API startup failed; check NOTES_API_* settings");
  process.exitCode = 1;
}
