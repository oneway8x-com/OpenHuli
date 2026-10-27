import { listOwnerDevices, pairOwnerDevice } from "@corely/modules-devices";
import { ownerDeviceResponse, readDeviceJson } from "@/server/device-http";
import { getDeviceAccessStore } from "@/server/devices-runtime";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return ownerDeviceResponse(request, async (owner) =>
    Response.json(await listOwnerDevices(owner, getDeviceAccessStore())),
  );
}
export function POST(request: Request) {
  return ownerDeviceResponse(request, async (owner) =>
    Response.json(
      await pairOwnerDevice(
        await readDeviceJson(request),
        owner,
        getDeviceAccessStore(),
      ),
      { status: 201 },
    ),
  );
}
