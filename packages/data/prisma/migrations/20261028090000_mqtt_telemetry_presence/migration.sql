BEGIN;

-- AlterTable
ALTER TABLE "DeviceTelemetry" ADD COLUMN     "sensorErrorsJson" TEXT NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "DevicePresence" (
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "bootId" TEXT NOT NULL,
    "backendEpoch" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,
    "sampledAt" TIMESTAMPTZ(6) NOT NULL,
    "telemetrySequence" BIGINT,
    "presenceSequence" BIGINT,

    CONSTRAINT "DevicePresence_pkey" PRIMARY KEY ("tenantId","deviceId")
);

-- CreateIndex
CREATE INDEX "DeviceTelemetry_sampledAt_idx" ON "DeviceTelemetry"("sampledAt");

-- AddForeignKey
ALTER TABLE "DevicePresence" ADD CONSTRAINT "DevicePresence_tenantId_deviceId_fkey" FOREIGN KEY ("tenantId", "deviceId") REFERENCES "Device"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
