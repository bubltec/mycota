import { DeleteCommand, type DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { DynamoOAuthStore } from './oauth.store.js';

type Item = Record<string, unknown>;

/** A doc client over a Map keyed by PK, handling only the commands the store uses. */
function fakeDb() {
  const rows = new Map<string, Item>();
  const send = async (command: unknown): Promise<Item> => {
    if (command instanceof PutCommand) {
      rows.set(command.input.Item!.PK as string, structuredClone(command.input.Item!));
      return {};
    }
    if (command instanceof GetCommand) return { Item: structuredClone(rows.get(command.input.Key!.PK as string)) };
    if (command instanceof DeleteCommand) {
      const old = rows.get(command.input.Key!.PK as string);
      rows.delete(command.input.Key!.PK as string);
      return { Attributes: old };
    }
    throw new Error('unsupported command');
  };
  return { db: { send } as unknown as DynamoDBDocumentClient, rows };
}

const client = { clientId: 'c1', clientName: 'Claude', redirectUris: ['https://claude.ai/cb'], createdAt: '2026-01-01T00:00:00.000Z' };
const code = { codeHash: 'h1', clientId: 'c1', userKey: 'github:1', redirectUri: 'https://claude.ai/cb', codeChallenge: 'x', scope: 's', expiresAt: 1_900_000_000 };
const token = { tokenHash: 't1', kind: 'refresh' as const, clientId: 'c1', userKey: 'github:1', scope: 's', expiresAt: 1_900_000_000, createdAt: '2026-01-01T00:00:00.000Z' };

describe('DynamoOAuthStore', () => {
  it('stores clients, and strips key attributes on read', async () => {
    const store = new DynamoOAuthStore(fakeDb().db, 'auth');
    expect(await store.getClient('c1')).toBeUndefined();
    await store.putClient(client);
    expect(await store.getClient('c1')).toEqual(client);
  });

  it('lets a code be redeemed once, and sets the TTL attribute', async () => {
    const { db, rows } = fakeDb();
    const store = new DynamoOAuthStore(db, 'auth');
    await store.putCode(code);
    expect(rows.get('CODE#h1')).toMatchObject({ ttl: code.expiresAt });
    expect(await store.takeCode('h1')).toEqual(code);
    expect(await store.takeCode('h1')).toBeUndefined();
  });

  it('reads tokens without consuming them, and rotates (takes) refresh tokens', async () => {
    const store = new DynamoOAuthStore(fakeDb().db, 'auth');
    await store.putToken(token);
    expect(await store.getToken('t1')).toEqual(token);
    expect(await store.getToken('t1')).toEqual(token);
    expect(await store.takeToken('t1')).toEqual(token);
    expect(await store.getToken('t1')).toBeUndefined();
    expect(await store.takeToken('t1')).toBeUndefined();
  });
});
