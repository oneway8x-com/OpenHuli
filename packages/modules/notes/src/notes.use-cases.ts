import { z } from "zod";
import { OpenHuliIdSchema } from "@corely/contracts";
const Scope = z
  .object({
    tenantId: OpenHuliIdSchema,
    idempotencyKey: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9:._-]+$/),
  })
  .strict();
const Input = z.object({ text: z.string().trim().min(1).max(2000) }).strict();
export interface Note {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  text: string;
  createdAt: string;
}
export interface NotesStore {
  create(tenantId: string, key: string, text: string): Note;
  find(tenantId: string, key: string): Note | null;
}
export class NoteConflict extends Error {}
export function createNote(
  value: unknown,
  context: unknown,
  store: NotesStore,
): Note {
  const scope = Scope.parse(context),
    input = Input.parse(value);
  return store.create(scope.tenantId, scope.idempotencyKey, input.text);
}
export function findNote(context: unknown, store: NotesStore): Note | null {
  const scope = Scope.parse(context);
  return store.find(scope.tenantId, scope.idempotencyKey);
}
