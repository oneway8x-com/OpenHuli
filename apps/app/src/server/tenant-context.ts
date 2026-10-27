import { authenticateOwner } from "./auth";

/** Session claims select a tenant only after live session and OWNER membership checks. */
export async function getTenantContext(request: Request) {
  const owner = await authenticateOwner(request);
  return { tenantId: owner.tenantId, userId: owner.userId };
}
