BEGIN;

ALTER TABLE "AgentRun" ADD COLUMN "budgetReservedMicros" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(6), ADD COLUMN "privacyClearedAt" TIMESTAMPTZ(6);
ALTER TABLE "ConversationTurn" ADD COLUMN "usageStatus" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN "estimatedCostMicros" INTEGER;
CREATE TABLE "ConversationQuota" (
 "tenantId" TEXT NOT NULL, "deviceId" TEXT NOT NULL, "day" DATE NOT NULL,
 "sessions" INTEGER NOT NULL DEFAULT 0, "audioBytes" INTEGER NOT NULL DEFAULT 0,
 "reservedMicros" INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY ("tenantId", "deviceId", "day")
);
CREATE TABLE "ConversationPhase" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "runId" TEXT NOT NULL,
 "turnId" TEXT, "executionId" TEXT, "phase" TEXT NOT NULL, "elapsedMs" INTEGER NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("tenantId", "runId") REFERENCES "AgentRun"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConversationPhase_tenantId_runId_createdAt_idx" ON "ConversationPhase"("tenantId", "runId", "createdAt");
CREATE INDEX "ConversationPhase_createdAt_idx" ON "ConversationPhase"("createdAt");

ALTER TABLE "ToolExecution" ADD COLUMN "privateDataCleared" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
