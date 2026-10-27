import {
  registerPairedManifest,
  authenticateScopedDevice,
} from "@corely/modules-devices";
import {
  deviceBearer,
  deviceResponse,
  readDeviceJson,
} from "@/server/device-http";
import { getDeviceAccessStore } from "@/server/devices-runtime";
export function POST(request: Request) {
  return deviceResponse(async () => {
    const token = deviceBearer(request);
    const store = getDeviceAccessStore();
    await authenticateScopedDevice(token, "mqtt", store);
    return Response.json(
      await registerPairedManifest(await readDeviceJson(request), token, store),
    );
  });
}
