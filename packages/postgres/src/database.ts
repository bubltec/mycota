import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClientLike, PoolLike, QueryResult, SqlDatabase } from './ports.js';

const tx = new AsyncLocalStorage<PoolClientLike>();

function wrap<T>(result: { rows: unknown[]; rowCount?: number | null }): QueryResult<T> {
  return {
    rows: result.rows as T[],
    rowCount: result.rowCount ?? result.rows.length,
  };
}

/**
 * Wraps an injected pool. Local Docker and RDS are the same adapter —
 * `FakeSqlDatabase` is the wrong primitive; run Postgres.
 */
export class PostgresDatabase implements SqlDatabase {
  constructor(private readonly pool: PoolLike) {}

  async query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
    const client = tx.getStore();
    const result = client ? await client.query(text, values) : await this.pool.query(text, values);
    return wrap<T>(result);
  }

  inTransaction(): boolean {
    return tx.getStore() !== undefined;
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (tx.getStore()) return work();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await tx.run(client, work);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The original error is the one to surface.
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
