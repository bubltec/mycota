export type TokenHealth = 'ok' | 'needs_reauth' | 'degraded';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface TokenRecord {
  provider: string;
  subjectId: string;
  displayName?: string;
  tokens: TokenSet;
  health: TokenHealth;
  updatedAt: string;
}

export interface TokenStore {
  get(provider: string, subjectId: string): Promise<TokenRecord | undefined>;
  put(record: TokenRecord): Promise<void>;
  delete(provider: string, subjectId: string): Promise<void>;
  listByProvider(provider: string): Promise<TokenRecord[]>;
}

export interface TokenRefresher {
  refresh(tokens: TokenSet): Promise<TokenSet>;
}

export interface SecretBox {
  seal(plaintext: Uint8Array): Promise<Uint8Array>;
  open(ciphertext: Uint8Array): Promise<Uint8Array>;
}

export interface AccessTokenResult {
  accessToken: string;
  health: TokenHealth;
  record: TokenRecord;
}
