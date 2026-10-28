import { z } from "zod";
import {
  ConsoleSnapshotSchema,
  type ConsoleSnapshot,
  type ConsoleCommandSchema,
} from "@corely/contracts";
export async function consoleFetch(
  path = "",
  command?: z.infer<typeof ConsoleCommandSchema>,
): Promise<unknown> {
  const response = await fetch(`/api/conversations${path}`, {
    cache: "no-store",
    ...(command
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        }
      : {}),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Your session expired. Sign in again."
        : response.status === 409
          ? "This conversation is read only. Start a new conversation."
          : "Could not reach the conversation runtime. Please try again.",
    );
  return response.json();
}
export async function fetchConversation(id: string): Promise<ConsoleSnapshot> {
  return ConsoleSnapshotSchema.parse(
    await consoleFetch(`?id=${encodeURIComponent(id)}`),
  );
}
export const ConversationListSchema = z.array(
  z.object({
    id: z.string(),
    deviceId: z.string().nullable(),
    createdAt: z.string(),
  }),
);
export const DeviceListSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    room: z.string().nullable().optional(),
    status: z.string(),
  }),
);
