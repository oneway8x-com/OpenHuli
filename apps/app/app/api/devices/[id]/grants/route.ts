import { assignOwnerDeviceGrant } from "@corely/modules-devices";
import { ownerDeviceResponse, readDeviceJson } from "@/server/device-http";
import { getDeviceAccessStore } from "@/server/devices-runtime";
export function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return ownerDeviceResponse(request, async (owner) => {
    await assignOwnerDeviceGrant(
      (await context.params).id,
      await readDeviceJson(request),
      owner,
      getDeviceAccessStore(),
    );
    return new Response(null, { status: 204 });
  });
}
