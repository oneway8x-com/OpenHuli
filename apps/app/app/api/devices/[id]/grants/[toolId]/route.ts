import { revokeOwnerDeviceGrant } from "@corely/modules-devices";
import { ownerDeviceResponse } from "@/server/device-http";
import { getDeviceAccessStore } from "@/server/devices-runtime";
export function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; toolId: string }> },
) {
  return ownerDeviceResponse(request, async (owner) => {
    const params = await context.params;
    await revokeOwnerDeviceGrant(
      params.id,
      params.toolId,
      owner,
      getDeviceAccessStore(),
    );
    return new Response(null, { status: 204 });
  });
}
