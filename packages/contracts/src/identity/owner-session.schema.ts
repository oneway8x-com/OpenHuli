import { z } from "zod";

export const OwnerSessionSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().nullable(),
  tenantId: z.string().min(1),
  tenantName: z.string().min(1),
});
export type OwnerSession = z.infer<typeof OwnerSessionSchema>;
export const RequestOwnerCodeSchema = z
  .object({ email: z.string().trim().toLowerCase().email() })
  .strict();
export const VerifyOwnerCodeSchema = RequestOwnerCodeSchema.extend({
  code: z.string().regex(/^\d{6}$/),
});
