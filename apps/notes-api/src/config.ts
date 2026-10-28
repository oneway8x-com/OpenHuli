import { z } from "zod";
const Config = z.object({
  NOTES_API_HOST: z.enum(["127.0.0.1", "::1"]).default("127.0.0.1"),
  NOTES_API_PORT: z.coerce.number().int().min(0).max(65535).default(3300),
  NOTES_API_TOKEN: z
    .string()
    .min(32)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/),
  NOTES_API_DATABASE: z.string().min(1).default(".local/notes.sqlite"),
});
export type NotesApiConfig = z.infer<typeof Config>;
export function readNotesApiConfig(env: NodeJS.ProcessEnv): NotesApiConfig {
  const result = Config.safeParse(env);
  if (!result.success)
    throw new Error("Invalid notes API configuration (NOTES_API_* settings)");
  return result.data;
}
