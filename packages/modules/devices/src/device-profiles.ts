import {
  DeviceCapabilityManifestSchema,
  PairDeviceSchema,
  type PairDeviceInput,
  type DeviceCapabilityManifest,
} from "@corely/contracts";
import { DeviceAccessError } from "./device-access.errors";

type Capability = DeviceCapabilityManifest["capabilities"][number];
const profiles = {
  "esp32-voice": {
    required: ["microphone", "ping"],
    allowed: [
      "microphone",
      "speaker",
      "display",
      "ping",
      "temperature",
      "humidity",
    ],
  },
  "esp32-microphone": {
    required: ["microphone"],
    allowed: ["microphone"],
  },
  "sensor-node": {
    required: ["ping"],
    allowed: ["temperature", "humidity", "display", "ping"],
  },
  "weather-station": {
    required: ["temperature", "humidity", "ping"],
    allowed: ["temperature", "humidity", "display", "ping"],
  },
} as const;

export function validateDeviceProfile(value: unknown): PairDeviceInput {
  const config = PairDeviceSchema.parse(value);
  const profile = profiles[config.profileId];
  const kinds = config.capabilities.map((cap) => cap.kind);
  if (
    config.profileId === "sensor-node" &&
    config.capabilities.some(
      (cap) => cap.kind === "display" && cap.maxTextLength > 32,
    )
  )
    throw new DeviceAccessError(
      400,
      "Sensor node displays support at most 32 characters",
    );
  if (
    profile.required.some((kind) => !kinds.includes(kind)) ||
    kinds.some((kind) => !new Set<string>(profile.allowed).has(kind))
  ) {
    throw new DeviceAccessError(
      400,
      "Capabilities do not match the selected device profile",
    );
  }
  return config;
}
function permits(owner: Capability, advertised: Capability): boolean {
  if (owner.kind !== advertised.kind) return false;
  if (owner.kind === "display" && advertised.kind === "display")
    return advertised.maxTextLength <= owner.maxTextLength;
  // Shared schemas pin microphone/speaker formats to the supported v1 PCM format.
  return true;
}
export function validateDeviceAdvertisement(
  value: unknown,
  deviceId: string,
  configuration: PairDeviceInput,
): DeviceCapabilityManifest {
  const manifest = DeviceCapabilityManifestSchema.parse(value);
  if (manifest.deviceId !== deviceId)
    throw new DeviceAccessError(403, "Device identity mismatch");
  for (const capability of manifest.capabilities) {
    if (!configuration.capabilities.some((owner) => permits(owner, capability)))
      throw new DeviceAccessError(
        403,
        "Advertised capability is not owner-configured",
      );
  }
  const required = profiles[configuration.profileId].required;
  if (
    required.some(
      (kind) => !manifest.capabilities.some((cap) => cap.kind === kind),
    )
  )
    throw new DeviceAccessError(400, "Required profile capability is missing");
  return manifest;
}
