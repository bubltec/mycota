import type { FastifyInstance } from 'fastify';
import { apiPrefixOf, type MycotaOAuthOptions } from './oauth.config.js';

export const RETURN_COOKIE = 'mycota_oauth_return';

type DiscoveryOptions = Pick<MycotaOAuthOptions, 'origin' | 'resourcePath' | 'scope' | 'appName' | 'apiPrefix'>;

/** RFC 9728: tells a client which authorization server protects the resource. */
export function protectedResourceMetadata(o: DiscoveryOptions) {
  return {
    resource: `${o.origin}${o.resourcePath}`,
    authorization_servers: [o.origin],
    scopes_supported: [o.scope],
    bearer_methods_supported: ['header'],
    resource_name: o.appName,
  };
}

/** RFC 8414: where to register, authorize and exchange tokens. */
export function authorizationServerMetadata(o: DiscoveryOptions) {
  const base = `${o.origin}${apiPrefixOf(o)}/oauth`;
  return {
    issuer: o.origin,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [o.scope],
    authorization_response_iss_parameter_supported: true,
  };
}

/**
 * Discovery documents live at the site root, outside Nest's global prefix, so
 * they are plain Fastify routes. Route `/.well-known/*` to the API at the CDN
 * or proxy for the same reason.
 */
export function registerOAuthWellKnown(fastify: FastifyInstance, o: DiscoveryOptions) {
  const json = (body: () => unknown) => async (_req: unknown, reply: { header: (k: string, v: string) => { send: (b: unknown) => unknown } }) =>
    reply.header('cache-control', 'max-age=300').send(body());
  for (const path of ['/.well-known/oauth-protected-resource', `/.well-known/oauth-protected-resource${o.resourcePath}`]) {
    fastify.get(path, json(() => protectedResourceMetadata(o)));
  }
  for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
    fastify.get(path, json(() => authorizationServerMetadata(o)));
  }
}

/**
 * Sign-in providers redirect to a fixed callback that lands on the web origin.
 * When sign-in started on the authorize page, send the browser back there
 * instead, so connecting a client is one uninterrupted flow. Applies to any
 * 302 from a `<apiPrefix>/auth/` callback route while the return cookie is set.
 */
export function registerOAuthReturnHook(fastify: FastifyInstance, o: Pick<MycotaOAuthOptions, 'apiPrefix'>) {
  const prefix = apiPrefixOf(o);
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (!request.url.startsWith(`${prefix}/auth/`) || !request.url.includes('/callback') || reply.statusCode !== 302) return payload;
    const back = request.cookies?.[RETURN_COOKIE];
    if (back?.startsWith(`${prefix}/oauth/authorize`)) {
      reply.header('location', back);
      reply.clearCookie(RETURN_COOKIE, { path: prefix });
    }
    return payload;
  });
}
