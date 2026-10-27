import { IdentityRepository } from "@corely/modules-identity";
import { getPrisma } from "./prisma";
export function getIdentityStore() {
  return new IdentityRepository(getPrisma());
}
