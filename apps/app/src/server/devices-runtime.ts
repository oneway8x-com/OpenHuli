import { DeviceAccessRepository } from "@corely/modules-devices";
import { getPrisma } from "./prisma";
export function getDeviceAccessStore() {
  return new DeviceAccessRepository(getPrisma());
}
