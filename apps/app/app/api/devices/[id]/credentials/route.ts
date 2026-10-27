import { rotateOwnerDeviceSecret } from "@corely/modules-devices";
import { ownerDeviceResponse, readDeviceJson } from "@/server/device-http";
import { getDeviceAccessStore } from "@/server/devices-runtime";
export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return ownerDeviceResponse(request, async (owner) =>
    Response.json(
      await rotateOwnerDeviceSecret(
        (await context.params).id,
        await readDeviceJson(request),
        owner,
        getDeviceAccessStore(),
      ),
    ),
  );
}
