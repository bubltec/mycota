import type { User } from '@bubltec/mycota-auth';
import type { OAuthStore } from './oauth.store.js';

export const MYCOTA_OAUTH_OPTIONS = Symbol('MYCOTA_OAUTH_OPTIONS');
export const OAUTH_STORE = Symbol('MYCOTA_OAUTH_STORE');

/** The app supplies everything; the package reads no `process.env`. */
export interface MycotaOAuthOptions {
  /** Public origin of the site, e.g. `https://example.com`. It is the issuer and the base of every URL. */
  origin: string;
  /** Path of the protected resource clients connect to, e.g. `/api/mcp`. */
  resourcePath: string;
  /** The one scope this server grants. */
  scope: string;
  /** Shown on the consent, sign-in and error pages and in the discovery documents. */
  appName: string;
  /** Prefix Nest serves controllers under. Default `/api`. */
  apiPrefix?: string;
  /** Whether a signed-in user may connect a client. Checked at consent and on every bearer request. */
  isAllowed(user: User): boolean | Promise<boolean>;
  /** Completes "<client> is asking to ___ as <user>." on the consent page. */
  grants: string;
  /** Sign-in links offered when nobody is signed in, e.g. `{ label: 'Sign in with GitHub', href: '/api/auth/github' }`. */
  signIn?: { label: string; href: string }[];
  /**
   * Enables `POST /oauth/local-sign-in`, which signs in as this email without
   * a password. For local and dev stages only: leave it unset in production.
   */
  localSignInEmail?: string;
  /** Where local sign-in lands when it did not start from the authorize page. Default `/`. */
  localSignInRedirect?: string;
  /** Extra CSS appended to the built-in (neutral, dark) page styles. */
  css?: string;
  /** Persistence. Give this, or `tableName` to use DynamoDB through the shared `DYNAMO_DOC_CLIENT`. */
  store?: OAuthStore;
  tableName?: string;
  codeTtlSeconds?: number;
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
}

export const apiPrefixOf = (o: Pick<MycotaOAuthOptions, 'apiPrefix'>) => (o.apiPrefix ?? '/api').replace(/\/$/, '');
