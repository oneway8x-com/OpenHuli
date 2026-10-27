import type {
  DeviceCapabilityManifest,
  DevicePurpose,
  PairDeviceInput,
} from "@corely/contracts";
export interface StoredAccessDevice {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  configurationJson: string | null;
  manifestJson: string;
}
export interface StoredAccessCredential {
  id: string;
  tenantId: string;
  deviceId: string;
  purpose: string;
  secretHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}
export interface NewAccessCredential {
  id: string;
  purpose: DevicePurpose;
  secretHash: string;
  expiresAt: Date;
}
export interface DeviceSession {
  tenantId: string;
  deviceId: string;
  credentialId: string;
  purpose: DevicePurpose;
}
export interface DeviceAccessStore {
  pair(
    tenantId: string,
    deviceId: string,
    configuration: PairDeviceInput,
    credentials: NewAccessCredential[],
  ): Promise<StoredAccessDevice>;
  findDevice(
    tenantId: string,
    deviceId: string,
  ): Promise<StoredAccessDevice | null>;
  listDevices(tenantId: string): Promise<StoredAccessDevice[]>;
  credentials(
    tenantId: string,
    deviceId: string,
  ): Promise<Omit<StoredAccessCredential, "secretHash">[]>;
  findCredential(
    tenantId: string,
    credentialId: string,
  ): Promise<StoredAccessCredential | null>;
  saveManifest(
    tenantId: string,
    deviceId: string,
    manifest: DeviceCapabilityManifest,
  ): Promise<boolean>;
  rotateCredential(
    tenantId: string,
    deviceId: string,
    oldId: string,
    replacement: NewAccessCredential,
    now: Date,
  ): Promise<boolean>;
  revokeCredential(
    tenantId: string,
    deviceId: string,
    credentialId: string,
    now: Date,
  ): Promise<boolean>;
  deactivateDevice(
    tenantId: string,
    deviceId: string,
    now: Date,
  ): Promise<boolean>;
  assignGrant(
    tenantId: string,
    deviceId: string,
    toolId: string,
    targets: string[],
    expiresAt: Date,
  ): Promise<void>;
  revokeGrant(
    tenantId: string,
    deviceId: string,
    toolId: string,
    now: Date,
  ): Promise<void>;
  grants(
    tenantId: string,
    deviceId: string,
  ): Promise<
    {
      toolId: string;
      targetDeviceIdsJson: string;
      expiresAt: Date;
      revokedAt: Date | null;
    }[]
  >;
  findGrant(
    tenantId: string,
    deviceId: string,
    toolId: string,
    now: Date,
  ): Promise<{ targetDeviceIdsJson: string } | null>;
}
