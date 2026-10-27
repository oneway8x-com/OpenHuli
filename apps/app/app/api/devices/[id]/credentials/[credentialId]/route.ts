import { revokeOwnerDeviceSecret } from "@corely/modules-devices";
import { ownerDeviceResponse } from "@/server/device-http";
import { getDeviceAccessStore } from "@/server/devices-runtime";
export function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; credentialId: string }> },
) {
  return ownerDeviceResponse(request, async (owner) => {
    const params = await context.params;
    await revokeOwnerDeviceSecret(
      params.id,
      params.credentialId,
      owner,
      getDeviceAccessStore(),
    );
    return new Response(null, { status: 204 });
  });
}
