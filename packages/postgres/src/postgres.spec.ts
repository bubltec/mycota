import { describe, expect, it } from 'vitest';
import { PostgresDatabase } from './database.js';
import { applyMigrations, VECTOR_EXTENSION } from './migrate.js';
import type { PoolClientLike, PoolLike } from './ports.js';

function recordingPool() {
  const log: string[] = [];
  const client: PoolClientLike = {
    query: async (text) => {
      log.push(text.split('\n')[0]!.trim());
      if (text.includes('SELECT id FROM schema_migrations')) {
        return { rows: [{ id: VECTOR_EXTENSION.id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      log.push('RELEASE');
    },
  };
  const pool: PoolLike = {
    query: async (text) => {
      log.push(`pool:${text.split('\n')[0]!.trim()}`);
      if (text.includes('SELECT id FROM schema_migrations')) {
        return { rows: [{ id: VECTOR_EXTENSION.id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    connect: async () => {
      log.push('CONNECT');
      return client;
    },
    end: async () => {
      log.push('END');
    },
  };
  return { pool, log };
}

describe('PostgresDatabase', () => {
  it('runs work on the pool outside a transaction', async () => {
    const { pool, log } = recordingPool();
    const db = new PostgresDatabase(pool);
    await db.query('SELECT 1');
    expect(log).toEqual(['pool:SELECT 1']);
    expect(db.inTransaction()).toBe(false);
  });

  it('BEGINs once and nested transaction calls join it', async () => {
    const { pool, log } = recordingPool();
    const db = new PostgresDatabase(pool);
    await db.transaction(async () => {
      await db.query('INSERT INTO t VALUES (1)');
      await db.transaction(async () => {
        await db.query('INSERT INTO t VALUES (2)');
      });
    });
    expect(log).toEqual([
      'CONNECT',
      'BEGIN',
      'INSERT INTO t VALUES (1)',
      'INSERT INTO t VALUES (2)',
      'COMMIT',
      'RELEASE',
    ]);
  });

  it('rolls back and rethrows', async () => {
    const { pool, log } = recordingPool();
    const db = new PostgresDatabase(pool);
    await expect(
      db.transaction(async () => {
        await db.query('INSERT INTO t VALUES (1)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(log).toEqual(['CONNECT', 'BEGIN', 'INSERT INTO t VALUES (1)', 'ROLLBACK', 'RELEASE']);
  });
});

describe('applyMigrations', () => {
  it('skips ids already in schema_migrations', async () => {
    const { pool, log } = recordingPool();
    const db = new PostgresDatabase(pool);
    const ran = await applyMigrations(db, [VECTOR_EXTENSION, { id: 'app.events', sql: 'CREATE TABLE events (id uuid)' }]);
    expect(ran).toBe(1);
    expect(log.some((line) => line.includes('CREATE TABLE events'))).toBe(true);
    expect(log.filter((line) => line === 'CREATE EXTENSION IF NOT EXISTS vector')).toHaveLength(0);
  });
});
