import { getOwnerDevice, deactivateOwnerDevice } from "@corely/modules-devices";
import { ownerDeviceResponse } from "@/server/device-http";
import { getDeviceAccessStore } from "@/server/devices-runtime";
type RouteContext = { params: Promise<{ id: string }> };
export function GET(request: Request, context: RouteContext) {
  return ownerDeviceResponse(request, async (owner) =>
    Response.json(
      await getOwnerDevice(
        (await context.params).id,
        owner,
        getDeviceAccessStore(),
      ),
    ),
  );
}
export function DELETE(request: Request, context: RouteContext) {
  return ownerDeviceResponse(request, async (owner) => {
    await deactivateOwnerDevice(
      (await context.params).id,
      owner,
      getDeviceAccessStore(),
    );
    return new Response(null, { status: 204 });
  });
}
