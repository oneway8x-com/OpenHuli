BEGIN;

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_runId_fkey";

-- DropForeignKey
ALTER TABLE "ToolExecution" DROP CONSTRAINT "ToolExecution_runId_fkey";

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMPTZ(6),
ADD COLUMN     "retainTranscripts" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "turnId" TEXT,
ALTER COLUMN "partsJson" SET DEFAULT '[]';

-- AlterTable
ALTER TABLE "ToolExecution" ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMPTZ(6),
ADD COLUMN     "turnId" TEXT;

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToolGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "DeviceToolGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceTelemetry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "bootId" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "sampledAt" TIMESTAMPTZ(6) NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readingsJson" TEXT NOT NULL,

    CONSTRAINT "DeviceTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCommand" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "issuedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "resultJson" TEXT,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "DeviceCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "generationCompletedAt" TIMESTAMPTZ(6),
    "playbackCompletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "argumentsJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "decidedAt" TIMESTAMPTZ(6),
    "decidedByUserId" TEXT,

    CONSTRAINT "ExecutionApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "turnId" TEXT,
    "eventId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Device_tenantId_status_idx" ON "Device"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tenantId_id_key" ON "Device"("tenantId", "id");

-- CreateIndex
CREATE INDEX "DeviceCredential_tenantId_deviceId_expiresAt_idx" ON "DeviceCredential"("tenantId", "deviceId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCredential_tenantId_id_key" ON "DeviceCredential"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToolGrant_tenantId_deviceId_toolId_key" ON "DeviceToolGrant"("tenantId", "deviceId", "toolId");

-- CreateIndex
CREATE INDEX "DeviceTelemetry_tenantId_deviceId_sampledAt_idx" ON "DeviceTelemetry"("tenantId", "deviceId", "sampledAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceTelemetry_tenantId_deviceId_bootId_sequence_key" ON "DeviceTelemetry"("tenantId", "deviceId", "bootId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceTelemetry_tenantId_deviceId_messageId_key" ON "DeviceTelemetry"("tenantId", "deviceId", "messageId");

-- CreateIndex
CREATE INDEX "DeviceCommand_tenantId_deviceId_status_expiresAt_idx" ON "DeviceCommand"("tenantId", "deviceId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCommand_tenantId_id_key" ON "DeviceCommand"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCommand_tenantId_executionId_key" ON "DeviceCommand"("tenantId", "executionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_tenantId_runId_id_key" ON "ConversationTurn"("tenantId", "runId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_tenantId_runId_sequence_key" ON "ConversationTurn"("tenantId", "runId", "sequence");

-- CreateIndex
CREATE INDEX "ExecutionApproval_tenantId_status_expiresAt_idx" ON "ExecutionApproval"("tenantId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionApproval_tenantId_id_key" ON "ExecutionApproval"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionApproval_tenantId_executionId_key" ON "ExecutionApproval"("tenantId", "executionId");

-- CreateIndex
CREATE INDEX "ConversationUsage_tenantId_metric_createdAt_idx" ON "ConversationUsage"("tenantId", "metric", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationUsage_tenantId_runId_eventId_key" ON "ConversationUsage"("tenantId", "runId", "eventId");

-- CreateIndex
CREATE INDEX "AgentRun_tenantId_deviceId_createdAt_idx" ON "AgentRun"("tenantId", "deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_tenantId_expiresAt_idx" ON "AgentRun"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_tenantId_id_key" ON "AgentRun"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ToolExecution_tenantId_status_expiresAt_idx" ON "ToolExecution"("tenantId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ToolExecution_tenantId_id_key" ON "ToolExecution"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_tenantId_deviceId_fkey" FOREIGN KEY ("tenantId", "deviceId") REFERENCES "Device"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_tenantId_runId_fkey" FOREIGN KEY ("tenantId", "runId") REFERENCES "AgentRun"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_tenantId_runId_turnId_fkey" FOREIGN KEY ("tenantId", "runId", "turnId") REFERENCES "ConversationTurn"("tenantId", "runId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_tenantId_runId_fkey" FOREIGN KEY ("tenantId", "runId") REFERENCES "AgentRun"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_tenantId_runId_turnId_fkey" FOREIGN KEY ("tenantId", "runId", "turnId") REFERENCES "ConversationTurn"("tenantId", "runId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCredential" ADD CONSTRAINT "DeviceCredential_tenantId_deviceId_fkey" FOREIGN KEY ("tenantId", "deviceId") REFERENCES "Device"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceToolGrant" ADD CONSTRAINT "DeviceToolGrant_tenantId_deviceId_fkey" FOREIGN KEY ("tenantId", "deviceId") REFERENCES "Device"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceTelemetry" ADD CONSTRAINT "DeviceTelemetry_tenantId_deviceId_fkey" FOREIGN KEY ("tenantId", "deviceId") REFERENCES "Device"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_tenantId_deviceId_fkey" FOREIGN KEY ("tenantId", "deviceId") REFERENCES "Device"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_tenantId_executionId_fkey" FOREIGN KEY ("tenantId", "executionId") REFERENCES "ToolExecution"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_tenantId_runId_fkey" FOREIGN KEY ("tenantId", "runId") REFERENCES "AgentRun"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionApproval" ADD CONSTRAINT "ExecutionApproval_tenantId_executionId_fkey" FOREIGN KEY ("tenantId", "executionId") REFERENCES "ToolExecution"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationUsage" ADD CONSTRAINT "ConversationUsage_tenantId_runId_fkey" FOREIGN KEY ("tenantId", "runId") REFERENCES "AgentRun"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationUsage" ADD CONSTRAINT "ConversationUsage_tenantId_runId_turnId_fkey" FOREIGN KEY ("tenantId", "runId", "turnId") REFERENCES "ConversationTurn"("tenantId", "runId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Protocol sequences span the full unsigned 32-bit range.
ALTER TABLE "DeviceTelemetry" ADD CONSTRAINT "DeviceTelemetry_sequence_check" CHECK ("sequence" BETWEEN 0 AND 4294967295);
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_sequence_check" CHECK ("sequence" BETWEEN 1 AND 4294967295);
ALTER TABLE "ConversationUsage" ADD CONSTRAINT "ConversationUsage_quantity_check" CHECK ("quantity" >= 0);
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_expiry_check" CHECK ("expiresAt" > "issuedAt");

COMMIT;
