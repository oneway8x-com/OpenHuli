import {
  DeviceAccessRepository,
  resolveVoiceDevice,
  revalidateDeviceSession,
  watchDeviceSession,
} from "@corely/modules-devices";
import { PrismaService } from "@corely/data";
import type { VoiceAuthorization, VoiceIdentity } from "@corely/modules-voice";

/** Composition only: identity rules remain in the devices feature, persistence in its repository. */
export function createVoiceAuthorization(): VoiceAuthorization {
  let persistence: PrismaService | undefined;
  const store = () =>
    new DeviceAccessRepository((persistence ??= new PrismaService()));
  const session = (identity: VoiceIdentity) => ({
    tenantId: identity.tenantId,
    deviceId: identity.deviceId,
    credentialId: identity.credentialId,
    purpose: "voice" as const,
  });
  return {
    async authenticate(token) {
      const bound = await resolveVoiceDevice(token, store());
      return {
        identity: {
          tenantId: bound.session.tenantId,
          deviceId: bound.session.deviceId,
          credentialId: bound.session.credentialId,
          expiresAt: bound.expiresAt,
        },
        manifest: bound.manifest,
      };
    },
    async revalidate(identity) {
      await revalidateDeviceSession(session(identity), store());
    },
    watch(identity, close) {
      return watchDeviceSession(session(identity), store(), close);
    },
    async close() {
      await persistence?.disconnect();
    },
  };
}
