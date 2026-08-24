import type { AccessTokenResult, TokenRecord, TokenRefresher, TokenSet, TokenStore } from './ports.js';

export interface TokenVaultOptions {
  store: TokenStore;
  refreshers?: Record<string, TokenRefresher>;
  clock?: () => Date;
  /** Refresh this many ms before `expiresAt`. Default 60s. */
  refreshSkewMs?: number;
}

/**
 * Stores OAuth tokens, refreshes them before expiry, and marks
 * `needs_reauth` when refresh fails — the Zoho/Buffer silent-drop counter.
 */
export class TokenVault {
  constructor(private readonly options: TokenVaultOptions) {}

  async put(input: {
    provider: string;
    subjectId: string;
    tokens: TokenSet;
    displayName?: string;
  }): Promise<TokenRecord> {
    const record: TokenRecord = {
      provider: input.provider,
      subjectId: input.subjectId,
      displayName: input.displayName,
      tokens: input.tokens,
      health: 'ok',
      updatedAt: this.now().toISOString(),
    };
    await this.options.store.put(record);
    return record;
  }

  async get(provider: string, subjectId: string): Promise<TokenRecord | undefined> {
    return this.options.store.get(provider, subjectId);
  }

  async delete(provider: string, subjectId: string): Promise<void> {
    await this.options.store.delete(provider, subjectId);
  }

  async list(provider: string): Promise<TokenRecord[]> {
    return this.options.store.listByProvider(provider);
  }

  /**
   * Returns a usable access token, refreshing when close to expiry. On
   * refresh failure the record is `needs_reauth` and this throws.
   */
  async accessToken(provider: string, subjectId: string): Promise<AccessTokenResult> {
    const record = await this.options.store.get(provider, subjectId);
    if (!record) throw new Error(`no tokens for ${provider}:${subjectId}`);
    if (record.health === 'needs_reauth') {
      throw new ReauthRequiredError(provider, subjectId);
    }
    if (!this.needsRefresh(record.tokens)) {
      return { accessToken: record.tokens.accessToken, health: record.health, record };
    }

    const refresher = this.options.refreshers?.[provider];
    if (!refresher || !record.tokens.refreshToken) {
      await this.mark(record, 'needs_reauth');
      throw new ReauthRequiredError(provider, subjectId);
    }

    try {
      const nextTokens = await refresher.refresh(record.tokens);
      const next: TokenRecord = {
        ...record,
        tokens: nextTokens,
        health: 'ok',
        updatedAt: this.now().toISOString(),
      };
      await this.options.store.put(next);
      return { accessToken: nextTokens.accessToken, health: 'ok', record: next };
    } catch {
      await this.mark(record, 'needs_reauth');
      throw new ReauthRequiredError(provider, subjectId);
    }
  }

  private needsRefresh(tokens: TokenSet): boolean {
    if (!tokens.expiresAt) return false;
    const skew = this.options.refreshSkewMs ?? 60_000;
    return new Date(tokens.expiresAt).getTime() - this.now().getTime() <= skew;
  }

  private async mark(record: TokenRecord, health: TokenRecord['health']): Promise<void> {
    await this.options.store.put({ ...record, health, updatedAt: this.now().toISOString() });
  }

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }
}

export class ReauthRequiredError extends Error {
  readonly code = 'needs_reauth';

  constructor(
    readonly provider: string,
    readonly subjectId: string,
  ) {
    super(`${provider}:${subjectId} needs reauth`);
    this.name = 'ReauthRequiredError';
  }
}
