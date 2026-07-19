/**
 * Everything mycota's auth module needs from the consuming app — the whole
 * point is that mycota itself never reads process.env directly, so a second
 * site configures its own values instead of inheriting btfp's. See
 * apps/bff/src/mycota-config.ts for where these are actually read from env.
 */
export interface MycotaAuthConfig {
  jwtSecret: string;
  webOrigin: string;
  usersTableName: string;
  emailFromAddress: string;
  sessionCookieName?: string;
  stage?: string;
  awsRegion?: string;
  bedrockInferenceProfileId?: string;
  braveSearchApiKey?: string;
  github?: { clientId: string; clientSecret: string; callbackUrl: string };
  google?: { clientId: string; clientSecret: string; callbackUrl: string };
}

export const MYCOTA_AUTH_CONFIG = Symbol('MYCOTA_AUTH_CONFIG');
