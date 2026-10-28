// Local demo database migrations. Increase user_version with each compatible schema change.
export const notesMigrations = [
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, idempotencyKey TEXT NOT NULL,
    text TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(tenantId, idempotencyKey)
  );`,
] as const;
