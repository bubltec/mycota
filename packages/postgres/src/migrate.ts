import type { Migration, SqlDatabase } from './ports.js';

const ENSURE_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)
`;

/**
 * First migration most apps want. Product tables stay in the consuming app.
 * RDS Postgres 16+ and the `pgvector/pgvector` image both ship the extension.
 */
export const VECTOR_EXTENSION: Migration = {
  id: 'mycota.vector',
  sql: 'CREATE EXTENSION IF NOT EXISTS vector',
};

/**
 * Applies numbered SQL in order. Each migration runs inside a transaction
 * (unless the SQL cannot — `CREATE INDEX CONCURRENTLY` belongs in its own
 * migration and should not be mixed with this helper).
 */
export async function applyMigrations(db: SqlDatabase, migrations: Migration[]): Promise<number> {
  await db.query(ENSURE_TABLE);
  const applied = await db.query<{ id: string }>('SELECT id FROM schema_migrations');
  const seen = new Set(applied.rows.map((row) => row.id));
  let ran = 0;
  for (const migration of migrations) {
    if (!migration.id.trim()) throw new Error('migration id is required');
    if (seen.has(migration.id)) continue;
    await db.transaction(async () => {
      await db.query(migration.sql);
      await db.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
    });
    ran += 1;
  }
  return ran;
}
