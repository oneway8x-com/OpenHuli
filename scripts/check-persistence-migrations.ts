import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getTestDatabaseUrl } from "./test-database.ts";

// Only touches uniquely named schemas in the explicitly selected disposable local test DB.
const db = new pg.Client({ connectionString: getTestDatabaseUrl() });
const baseline = await readFile(
  new URL(
    "../packages/data/prisma/migrations/20260720110609_init/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const upgrade = await readFile(
  new URL(
    "../packages/data/prisma/migrations/20261027210000_device_conversation_persistence/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const deviceAccess = await readFile(
  new URL(
    "../packages/data/prisma/migrations/20261027220000_device_access/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
await db.connect();
try {
  for (const seeded of [false, true]) {
    const schema = `migration_test_${randomUUID().replaceAll("-", "")}`;
    await db.query(`CREATE SCHEMA "${schema}"`);
    try {
      await db.query(`SET search_path TO "${schema}"`);
      await db.query(baseline);
      if (seeded) {
        await db.query(`
          INSERT INTO "Tenant" (id, name, slug) VALUES ('tenant', 'Baseline', 'baseline');
          INSERT INTO "AgentRun" (id, "tenantId", status, "updatedAt", "metadataJson") VALUES ('run', 'tenant', 'active', now(), '{"legacy":true}');
          INSERT INTO "Message" (id, "tenantId", "runId", role, "partsJson", "contentText") VALUES ('message', 'tenant', 'run', 'user', '[]', 'retained legacy text');
          INSERT INTO "ToolExecution" (id, "tenantId", "runId", "toolCallId", "toolName", "inputJson", status) VALUES ('execution', 'tenant', 'run', 'call', 'notes.create', '{"text":"original"}', 'unknown');
          INSERT INTO "IntegrationConnection" (id, "tenantId", "providerKey", "authMethod", "updatedAt") VALUES ('connection', 'tenant', 'notes', 'none', now());
          INSERT INTO "AuditLog" (id, "tenantId", action, entity, "entityId") VALUES ('audit', 'tenant', 'created', 'run', 'run');
          INSERT INTO "IdempotencyKey" (id, "tenantId", "actionKey", key, "updatedAt") VALUES ('key', 'tenant', 'notes.create', 'call', now());
        `);
      }
      await db.query(upgrade);
      if (seeded) {
        await db.query(`INSERT INTO "Device" (id,"tenantId",name,"manifestJson") VALUES ('legacy-device','tenant','Legacy','{}');
          INSERT INTO "DeviceCredential" (id,"tenantId","deviceId","secretHash","expiresAt") VALUES ('legacy-credential','tenant','legacy-device',repeat('a',64),now()+interval '1 day');
          INSERT INTO "DeviceToolGrant" (id,"tenantId","deviceId","toolId","expiresAt") VALUES ('legacy-grant','tenant','legacy-device','device.ping',now()+interval '1 day');`);
      }
      await db.query(deviceAccess);
      if (seeded) {
        const legacy = await db.query(
          'SELECT "configurationJson",purpose,"secretHash","targetDeviceIdsJson" FROM "Device" d JOIN "DeviceCredential" c ON c."deviceId"=d.id JOIN "DeviceToolGrant" g ON g."deviceId"=d.id WHERE d.id=$1',
          ["legacy-device"],
        );
        assert.deepEqual(legacy.rows, [
          {
            configurationJson: null,
            purpose: "legacy",
            secretHash: "a".repeat(64),
            targetDeviceIdsJson: "[]",
          },
        ]);
        const run = await db.query(
          'SELECT "metadataJson", "retainTranscripts", "deviceId" FROM "AgentRun" WHERE id = $1',
          ["run"],
        );
        assert.deepEqual(run.rows, [
          {
            metadataJson: '{"legacy":true}',
            retainTranscripts: false,
            deviceId: null,
          },
        ]);
        const message = await db.query(
          'SELECT "contentText", "turnId" FROM "Message" WHERE id = $1',
          ["message"],
        );
        assert.deepEqual(message.rows, [
          { contentText: "retained legacy text", turnId: null },
        ]);
        const execution = await db.query(
          'SELECT status, "inputJson", "turnId" FROM "ToolExecution" WHERE id = $1',
          ["execution"],
        );
        assert.deepEqual(execution.rows, [
          { status: "unknown", inputJson: '{"text":"original"}', turnId: null },
        ]);
        for (const table of [
          "IntegrationConnection",
          "AuditLog",
          "IdempotencyKey",
        ]) {
          const result = await db.query(
            `SELECT count(*)::int AS count FROM "${table}"`,
          );
          assert.equal(result.rows[0].count, 1);
        }
      }
      console.log(
        `Persistence migrations passed: ${seeded ? "seeded baseline preserved" : "fresh schema"}.`,
      );
    } finally {
      // Clear a failed migration transaction before cleaning up only this run's schema.
      await db.query("ROLLBACK");
      await db.query("SET search_path TO public");
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
  }
} finally {
  await db.end();
}
