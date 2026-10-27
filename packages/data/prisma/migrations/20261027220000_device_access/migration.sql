BEGIN;
ALTER TABLE "Device" ADD COLUMN "configurationJson" TEXT;
ALTER TABLE "DeviceCredential" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "DeviceCredential" ADD CONSTRAINT "DeviceCredential_purpose_check" CHECK ("purpose" IN ('legacy', 'voice', 'mqtt'));
ALTER TABLE "DeviceToolGrant" ADD COLUMN "targetDeviceIdsJson" TEXT NOT NULL DEFAULT '[]';
COMMIT;
