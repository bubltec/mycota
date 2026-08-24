import type { TokenRecord, TokenStore } from './ports.js';

function key(provider: string, subjectId: string): string {
  return `${provider}:${subjectId}`;
}

export class MemoryTokenStore implements TokenStore {
  private readonly records = new Map<string, TokenRecord>();

  async get(provider: string, subjectId: string): Promise<TokenRecord | undefined> {
    const record = this.records.get(key(provider, subjectId));
    return record ? structuredClone(record) : undefined;
  }

  async put(record: TokenRecord): Promise<void> {
    this.records.set(key(record.provider, record.subjectId), structuredClone(record));
  }

  async delete(provider: string, subjectId: string): Promise<void> {
    this.records.delete(key(provider, subjectId));
  }

  async listByProvider(provider: string): Promise<TokenRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.provider === provider)
      .map((record) => structuredClone(record));
  }
}
