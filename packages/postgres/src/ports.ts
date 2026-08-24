/**
 * One parameterized query's result. `rowCount` is 0 when the driver reports null.
 */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

/**
 * Narrow pool so `@bubltec/mycota-postgres` does not take a `pg` dependency.
 * The consuming app constructs `pg.Pool` (or a test double) and passes it in.
 */
export interface PoolClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
  release(): void;
}

export interface PoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
}

export interface SqlClient {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

/**
 * Postgres (local Docker or RDS). Nested `transaction` calls join the open
 * transaction — inner layers never import `pg`. Product tables stay in the app.
 */
export interface SqlDatabase extends SqlClient {
  transaction<T>(work: () => Promise<T>): Promise<T>;
  inTransaction(): boolean;
  close(): Promise<void>;
}

export interface Migration {
  id: string;
  sql: string;
}
