import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotesRepository, createNote, findNote } from "../index";
describe("persisted notes use cases", () => {
  it("upgrades an unversioned seeded demo and rejects newer schemas without deleting notes", () => {
    const sqlite: typeof import("node:sqlite") = createRequire(import.meta.url)(
      "node:sqlite",
    );
    const dir = mkdtempSync(join(tmpdir(), "openhuli-notes-migration-")),
      path = join(dir, "notes.sqlite");
    const legacy = new sqlite.DatabaseSync(path);
    legacy.exec(
      "CREATE TABLE notes (id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, idempotencyKey TEXT NOT NULL, text TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(tenantId,idempotencyKey));",
    );
    legacy
      .prepare("INSERT INTO notes VALUES (?,?,?,?,?)")
      .run(
        "note",
        "tenant",
        "key",
        "Preserved note",
        "2026-10-27T12:00:00.000Z",
      );
    legacy.close();
    try {
      const store = new NotesRepository(path);
      expect(store.find("tenant", "key")?.text).toBe("Preserved note");
      store.close();
      const future = new sqlite.DatabaseSync(path);
      future.exec("PRAGMA user_version=99");
      future.close();
      expect(() => new NotesRepository(path)).toThrow(
        "Unsupported notes database version",
      );
      const inspected = new sqlite.DatabaseSync(path);
      expect(inspected.prepare("SELECT text FROM notes").get()?.text).toBe(
        "Preserved note",
      );
      inspected.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("deduplicates durable identities across repository restart and isolates tenants", () => {
    const directory = mkdtempSync(join(tmpdir(), "openhuli-notes-")),
      path = join(directory, "notes.sqlite");
    const context = { tenantId: "tenant-a", idempotencyKey: "execution-1" };
    let store = new NotesRepository(path);
    try {
      const first = createNote({ text: " Note " }, context, store);
      expect(first.text).toBe("Note");
      store.close();
      store = new NotesRepository(path);
      expect(createNote({ text: "Note" }, context, store)).toEqual(first);
      expect(findNote({ ...context, tenantId: "tenant-b" }, store)).toBeNull();
      expect(
        createNote(
          { text: "Other" },
          { ...context, tenantId: "tenant-b" },
          store,
        ).id,
      ).not.toBe(first.id);
      expect(() => createNote({ text: "changed" }, context, store)).toThrow(
        "different content",
      );
      expect(() =>
        createNote({ text: "Note", tenantId: "spoof" }, context, store),
      ).toThrow();
      expect(() =>
        createNote({ text: "x".repeat(2001) }, context, store),
      ).toThrow();
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
