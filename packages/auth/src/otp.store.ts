import { DeleteCommand, GetCommand, PutCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface OtpRecord {
  codeHash: string;
  expiresAt: number;
  issuedAt: number;
  attempts: number;
  /** Start of the current send-counting window. */
  windowStart: number;
  sendCount: number;
  /** Plaintext code, only ever set on explicit local/test stages (see OtpService). */
  testCode?: string;
}

/** Persistence port for pending one-time codes, keyed by `<channel>#<identifier>`. */
export interface OtpStore {
  get(key: string): Promise<OtpRecord | undefined>;
  put(key: string, record: OtpRecord): Promise<void>;
  /** Atomically increments and returns the attempt count, so parallel guesses can't dodge the limit. */
  recordAttempt(key: string): Promise<number>;
  delete(key: string): Promise<void>;
}

export class InMemoryOtpStore implements OtpStore {
  private readonly records = new Map<string, OtpRecord>();

  async get(key: string) {
    const r = this.records.get(key);
    return r ? { ...r } : undefined;
  }
  async put(key: string, record: OtpRecord) {
    this.records.set(key, { ...record });
  }
  async recordAttempt(key: string) {
    const r = this.records.get(key);
    if (!r) return Number.MAX_SAFE_INTEGER;
    r.attempts += 1;
    return r.attempts;
  }
  async delete(key: string) {
    this.records.delete(key);
  }
}

/**
 * Stores pending codes as `OTP#<key>` items in the users table (same table,
 * disjoint key prefix, no new infrastructure). Items carry `ttl` (epoch
 * seconds) so enabling DynamoDB TTL on that attribute cleans them up; the
 * service also checks `expiresAt` itself, so TTL lag is harmless.
 */
export class DynamoOtpStore implements OtpStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  private pk(key: string) {
    return `OTP#${key}`;
  }

  async get(key: string) {
    const out = await this.db.send(new GetCommand({ TableName: this.tableName, Key: { PK: this.pk(key) } }));
    if (!out.Item) return undefined;
    const { PK: _pk, ttl: _ttl, ...record } = out.Item;
    return record as OtpRecord;
  }

  async put(key: string, record: OtpRecord) {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...record, PK: this.pk(key), ttl: Math.ceil((record.windowStart + 2 * 60 * 60 * 1000) / 1000) },
      }),
    );
  }

  async recordAttempt(key: string) {
    try {
      const out = await this.db.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: this.pk(key) },
          UpdateExpression: 'ADD attempts :one',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':one': 1 },
          ReturnValues: 'UPDATED_NEW',
        }),
      );
      return Number(out.Attributes?.attempts ?? Number.MAX_SAFE_INTEGER);
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return Number.MAX_SAFE_INTEGER;
      throw err;
    }
  }

  async delete(key: string) {
    await this.db.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: this.pk(key) } }));
  }
}
