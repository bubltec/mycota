import { DeleteCommand, type DynamoDBDocumentClient, PutCommand, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { commentDef, postDef, registry } from './fixture.testing.js';
import { entityDef } from './entity-def.js';
import { DynamoContentStore, InMemoryContentStore, rowsToSnapshot } from './store.js';

describe('entityDef', () => {
  it('derives single-table keys for roots and children', () => {
    expect(postDef.address({ id: 'p1' })).toEqual({ PK: 'POST#p1', SK: 'POST' });
    expect(commentDef.address({ id: 'c1', parentId: 'p1' })).toEqual({ PK: 'POST#p1', SK: 'COMMENT#c1' });
    expect(postDef.owns('POST')).toBe(true);
    expect(postDef.owns('COMMENT#c1')).toBe(false);
    expect(commentDef.owns('COMMENT#c1')).toBe(true);
    expect(commentDef).toMatchObject({ collection: 'comments', parent: 'post', parentField: 'postId', idPrefix: 'comment', lifecycle: 'status' });
  });
  it('lets a table keep its own key tokens', () => {
    const topic = entityDef({ name: 'topic', key: 'TOPIC' });
    const ref = entityDef({ name: 'reference', key: 'REF', collection: 'references', idPrefix: 'ref', parent: topic, parentField: 'topicId' });
    expect(ref.address({ id: 'r', parentId: 't' })).toEqual({ PK: 'TOPIC#t', SK: 'REF#r' });
  });
});

describe('InMemoryContentStore', () => {
  it('stores copies, and removes by entity', async () => {
    const store = new InMemoryContentStore(registry());
    const item = { id: 'p1', title: 't' };
    await store.put('post', item);
    item.title = 'mutated';
    expect((await store.loadAll()).posts).toEqual([{ id: 'p1', title: 't' }]);
    await store.remove([{ entity: 'post', ref: { id: 'p1' } }]);
    expect((await store.loadAll()).posts).toEqual([]);
  });
});

describe('DynamoContentStore', () => {
  function fakeDb() {
    const rows = new Map<string, Record<string, any>>();
    const key = (k: any) => `${k.PK}|${k.SK}`;
    const send = async (command: unknown): Promise<any> => {
      if (command instanceof PutCommand) return void rows.set(key(command.input.Item), structuredClone(command.input.Item!));
      if (command instanceof ScanCommand) return { Items: structuredClone([...rows.values()]) };
      if (command instanceof BatchWriteCommand) {
        for (const r of Object.values(command.input.RequestItems!)[0] as any[]) rows.delete(key(r.DeleteRequest.Key));
        return { UnprocessedItems: {} };
      }
      if (command instanceof DeleteCommand) return {};
      throw new Error('unsupported');
    };
    return { db: { send } as unknown as DynamoDBDocumentClient, rows };
  }

  it('writes rows at the def’s address, and reads them back sorted into collections', async () => {
    const { db, rows } = fakeDb();
    const store = new DynamoContentStore(db, 'content', registry());
    await store.put('post', { id: 'p1', title: 't' } as never);
    await store.put('comment', { id: 'c1', postId: 'p1', text: 'x' } as never);
    expect(rows.get('POST#p1|POST')).toMatchObject({ entity: 'post', id: 'p1' });
    expect(rows.get('POST#p1|COMMENT#c1')).toMatchObject({ entity: 'comment', postId: 'p1' });
    const snapshot = await store.loadAll();
    expect(snapshot.posts).toEqual([{ id: 'p1', title: 't' }]);
    expect(snapshot.comments).toEqual([{ id: 'c1', postId: 'p1', text: 'x' }]);
  });

  it('deletes by address, and ignores rows no entity owns', async () => {
    const { db, rows } = fakeDb();
    const store = new DynamoContentStore(db, 'content', registry());
    await store.put('post', { id: 'p1' });
    await store.put('comment', { id: 'c1', postId: 'p1' } as never);
    await store.remove([{ entity: 'comment', ref: { id: 'c1', parentId: 'p1' } }]);
    expect([...rows.keys()]).toEqual(['POST#p1|POST']);
    expect(rowsToSnapshot([{ PK: 'X', SK: 'UNKNOWN' }], registry().defs).posts).toEqual([]);
  });
});
