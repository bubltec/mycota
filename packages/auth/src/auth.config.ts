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
  /**
   * Sign in with Apple. `clientId` is the Services ID. `privateKey` is the
   * contents of the .p8 key (PEM). The callback is a cross-site POST
   * (`response_mode=form_post`), so the app must register `@fastify/formbody`.
   */
  apple?: { clientId: string; teamId: string; keyId: string; privateKey: string; callbackUrl: string };
  facebook?: { clientId: string; clientSecret: string; callbackUrl: string };
  /** `tenant` defaults to `common` (work, school and personal accounts). */
  microsoft?: { clientId: string; clientSecret: string; callbackUrl: string; tenant?: string };
  /**
   * Enables anonymous email sign-in (`/auth/anon-email/*`). The address is used
   * only to send the code and is stored only as an HMAC keyed with this pepper.
   * Keep the pepper in a secret store, apart from the database, and never lose
   * or change it: every anonymous account is addressed by hashes made with it.
   * At least 32 characters, and different from `jwtSecret`.
   */
  anonymousEmail?: { pepper: string };
  /** Shown in OTP messages, e.g. "grtzplz". Defaults to a generic message. */
  appName?: string;
}

export const MYCOTA_AUTH_CONFIG = Symbol('MYCOTA_AUTH_CONFIG');
