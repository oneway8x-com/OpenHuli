BEGIN;

-- AlterTable
ALTER TABLE "ToolExecution" ADD COLUMN     "actorJson" TEXT,
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dispatchDeadline" TIMESTAMPTZ(6),
ADD COLUMN     "effect" TEXT,
ADD COLUMN     "outcomeKind" TEXT,
ADD COLUMN     "policyHash" TEXT,
ADD COLUMN     "reconcileToken" TEXT,
ADD COLUMN     "reconcileUntil" TIMESTAMPTZ(6),
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "targetDeviceId" TEXT;

-- AlterTable
ALTER TABLE "ExecutionApproval" ADD COLUMN     "requestHash" TEXT;

-- CreateTable
CREATE TABLE "ToolPreauthorization" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "sourceDeviceId" TEXT,
    "targetDeviceId" TEXT,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolPreauthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolPreauthorization_tenantId_expiresAt_idx" ON "ToolPreauthorization"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ToolPreauthorization_tenantId_ownerUserId_toolId_policyHash_key" ON "ToolPreauthorization"("tenantId", "ownerUserId", "toolId", "policyHash", "scopeKey");

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_tenantId_targetDeviceId_fkey" FOREIGN KEY ("tenantId", "targetDeviceId") REFERENCES "Device"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolPreauthorization" ADD CONSTRAINT "ToolPreauthorization_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolPreauthorization" ADD CONSTRAINT "ToolPreauthorization_tenantId_sourceDeviceId_fkey" FOREIGN KEY ("tenantId", "sourceDeviceId") REFERENCES "Device"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolPreauthorization" ADD CONSTRAINT "ToolPreauthorization_tenantId_targetDeviceId_fkey" FOREIGN KEY ("tenantId", "targetDeviceId") REFERENCES "Device"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


COMMIT;
