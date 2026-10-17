import {
  BatchWriteCommand,
  type DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ContentSnapshot } from './content-index.js';
import { refOf, type EntityDef, type EntityRef } from './entity-def.js';
import type { EntityRegistry } from './registry.js';

/** Something to delete: the entity type plus how to address it. */
export interface RemoveTarget {
  entity: string;
  ref: EntityRef;
}

/**
 * Persistence port. The service depends on this, never on DynamoDB directly, so
 * the in-memory store can stand in for tests. It is generic over the registered
 * entities: no per-type methods. Cascades (a topic's references) are the
 * service's job; the store only writes and deletes what it is told to.
 */
export interface ContentStore {
  loadAll(): Promise<ContentSnapshot>;
  put(entity: string, item: { id: string }): Promise<void>;
  remove(targets: RemoveTarget[]): Promise<void>;
}

export class InMemoryContentStore implements ContentStore {
  private readonly data = new Map<string, Map<string, { id: string }>>();

  constructor(
    private readonly registry: EntityRegistry,
    seed: Record<string, { id: string }[]> = {},
  ) {
    for (const def of registry.defs) {
      this.data.set(def.collection, new Map((seed[def.collection] ?? []).map((i) => [i.id, i])));
    }
  }

  async loadAll(): Promise<ContentSnapshot> {
    return structuredClone(Object.fromEntries(this.registry.defs.map((d) => [d.collection, [...this.data.get(d.collection)!.values()]])));
  }

  async put(entity: string, item: { id: string }) {
    this.data.get(this.registry.def(entity).collection)!.set(item.id, structuredClone(item));
  }

  async remove(targets: RemoveTarget[]) {
    for (const { entity, ref } of targets) this.data.get(this.registry.def(entity).collection)!.delete(ref.id);
  }
}

type Row = Record<string, unknown> & { PK: string; SK: string; entity?: string };

function strip(row: Row): Record<string, unknown> {
  const { PK: _pk, SK: _sk, entity: _entity, ...rest } = row;
  return rest;
}

/** Sorts raw rows into a snapshot. Rows no entity owns are ignored, not fatal. */
export function rowsToSnapshot(rows: Row[], defs: readonly EntityDef[]): ContentSnapshot {
  const snapshot: ContentSnapshot = Object.fromEntries(defs.map((d) => [d.collection, []]));
  for (const row of rows) {
    const def = defs.find((d) => d.owns(row.SK));
    if (def) snapshot[def.collection]!.push(strip(row) as { id: string });
  }
  return snapshot;
}

/**
 * Single-table layout: each entity's keys come from its `EntityDef`. Reads are
 * one paginated Scan, cached by the service: at a few hundred rows that is
 * cheaper and simpler than per-view queries. Give the table a dedicated name
 * (or one whose other rows have sort keys no entity owns).
 */
export class DynamoContentStore implements ContentStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly registry: EntityRegistry,
  ) {}

  async loadAll(): Promise<ContentSnapshot> {
    const rows: Row[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await this.db.send(new ScanCommand({ TableName: this.tableName, ExclusiveStartKey }));
      rows.push(...((page.Items ?? []) as Row[]));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return rowsToSnapshot(rows, this.registry.defs);
  }

  async put(entity: string, item: { id: string }) {
    const def = this.registry.def(entity);
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: { ...def.address(refOf(def, item)), entity, ...item } }));
  }

  async remove(targets: RemoveTarget[]) {
    const keys = targets.map((t) => this.registry.def(t.entity).address(t.ref));
    for (let i = 0; i < keys.length; i += 25) {
      let requests: Record<string, unknown[]> = {
        [this.tableName]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
      };
      for (let attempt = 0; attempt < 5 && Object.keys(requests).length > 0; attempt++) {
        const result = await this.db.send(new BatchWriteCommand({ RequestItems: requests as never }));
        requests = (result.UnprocessedItems ?? {}) as Record<string, unknown[]>;
        if (Object.keys(requests).length > 0) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
      }
      if (Object.keys(requests).length > 0) throw new Error('BatchWrite left unprocessed deletes');
    }
  }
}
