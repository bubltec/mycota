import type { SecretBox, TokenRecord, TokenStore } from './ports.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Encrypts `tokens` at rest. Metadata (provider, subject, health) stays
 * plaintext so Connections can list `needs_reauth` without opening the box.
 */
export class EncryptedTokenStore implements TokenStore {
  constructor(
    private readonly inner: TokenStore,
    private readonly box: SecretBox,
  ) {}

  async get(provider: string, subjectId: string): Promise<TokenRecord | undefined> {
    const record = await this.inner.get(provider, subjectId);
    if (!record) return undefined;
    return this.open(record);
  }

  async put(record: TokenRecord): Promise<void> {
    await this.inner.put(await this.seal(record));
  }

  async delete(provider: string, subjectId: string): Promise<void> {
    await this.inner.delete(provider, subjectId);
  }

  async listByProvider(provider: string): Promise<TokenRecord[]> {
    const records = await this.inner.listByProvider(provider);
    return Promise.all(records.map((record) => this.open(record)));
  }

  private async seal(record: TokenRecord): Promise<TokenRecord> {
    const sealed = await this.box.seal(encoder.encode(JSON.stringify(record.tokens)));
    return { ...record, tokens: { accessToken: Buffer.from(sealed).toString('base64') } };
  }

  private async open(record: TokenRecord): Promise<TokenRecord> {
    const opened = await this.box.open(Buffer.from(record.tokens.accessToken, 'base64'));
    return { ...record, tokens: JSON.parse(decoder.decode(opened)) as TokenRecord['tokens'] };
  }
}
