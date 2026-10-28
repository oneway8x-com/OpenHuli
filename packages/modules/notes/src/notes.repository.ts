import type { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
// Vite 5 does not recognize this Node 22 builtin; load it through Node directly.
const sqlite: typeof import("node:sqlite") = createRequire(import.meta.url)(
  "node:sqlite",
);
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { NoteConflict, type Note, type NotesStore } from "./notes.use-cases";
import { notesMigrations } from "./notes.migrations";
const Row = z.object({
  id: z.string(),
  tenantId: z.string(),
  idempotencyKey: z.string(),
  text: z.string(),
  createdAt: z.string(),
});
/** A separate demo API database; no OpenHuli application tables or remote credentials. */
export class NotesRepository implements NotesStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new sqlite.DatabaseSync(path);
    try {
      this.db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;",
      );
      const row = z
        .object({ user_version: z.number().int().min(0) })
        .parse(this.db.prepare("PRAGMA user_version").get());
      if (row.user_version > notesMigrations.length)
        throw new Error("Unsupported notes database version");
      for (
        let version = row.user_version;
        version < notesMigrations.length;
        version++
      ) {
        const migration = notesMigrations[version];
        if (!migration) throw new Error("Missing notes migration");
        this.db.exec(migration);
        this.db.exec(`PRAGMA user_version=${version + 1}`);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } finally {
        this.db.close();
      }
      throw error;
    }
  }
  find(tenantId: string, key: string): Note | null {
    const row = this.db
      .prepare(
        "SELECT id, tenantId, idempotencyKey, text, createdAt FROM notes WHERE tenantId=? AND idempotencyKey=?",
      )
      .get(tenantId, key);
    return row ? Row.parse(row) : null;
  }
  create(tenantId: string, key: string, text: string): Note {
    this.db
      .prepare(
        "INSERT INTO notes (id, tenantId, idempotencyKey, text, createdAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenantId, idempotencyKey) DO NOTHING",
      )
      .run(randomUUID(), tenantId, key, text, new Date().toISOString());
    const note = this.find(tenantId, key);
    if (!note) throw new Error("Note persistence failed");
    if (note.text !== text)
      throw new NoteConflict(
        "Idempotency key was already used for different content",
      );
    return note;
  }
  close() {
    this.db.close();
  }
}
