import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { authorizationServerMetadata, protectedResourceMetadata, registerOAuthReturnHook, registerOAuthWellKnown } from './well-known.js';

const o = { origin: 'https://acme.example', resourcePath: '/api/mcp', scope: 'acme', appName: 'Acme' };

describe('discovery documents', () => {
  it('points the resource at its authorization server, and the server at its endpoints', () => {
    expect(protectedResourceMetadata(o)).toMatchObject({ resource: 'https://acme.example/api/mcp', authorization_servers: ['https://acme.example'], scopes_supported: ['acme'] });
    expect(authorizationServerMetadata({ ...o, apiPrefix: '/v1' })).toMatchObject({
      issuer: 'https://acme.example',
      authorization_endpoint: 'https://acme.example/v1/oauth/authorize',
      token_endpoint: 'https://acme.example/v1/oauth/token',
      registration_endpoint: 'https://acme.example/v1/oauth/register',
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('serves them at the well-known paths', async () => {
    const fastify = Fastify();
    registerOAuthWellKnown(fastify, o);
    for (const url of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-authorization-server']) {
      expect((await fastify.inject({ url })).statusCode).toBe(200);
    }
    expect((await fastify.inject({ url: '/.well-known/oauth-authorization-server' })).json()).toMatchObject({ issuer: o.origin });
  });
});

describe('registerOAuthReturnHook', () => {
  async function server() {
    const fastify = Fastify();
    registerOAuthReturnHook(fastify, {});
    await fastify.register(fastifyCookie);
    // Stand-in for a sign-in callback, which always goes to the web origin.
    fastify.get('/api/auth/github/callback', (_req, reply) => {
      reply.setCookie('session', 'jwt', { path: '/' });
      return reply.redirect('https://acme.example/?signedIn=1', 302);
    });
    return fastify;
  }

  it('resumes the authorize page after sign-in', async () => {
    const res = await (await server()).inject({
      url: '/api/auth/github/callback?code=x',
      cookies: { mycota_oauth_return: '/api/oauth/authorize?client_id=c' },
    });
    expect(res.headers.location).toBe('/api/oauth/authorize?client_id=c');
    const cookies = String(res.headers['set-cookie']);
    expect(cookies).toContain('session=jwt');
    expect(cookies).toMatch(/mycota_oauth_return=;/);
  });

  it('leaves normal sign-ins and foreign return paths alone', async () => {
    const app = await server();
    expect((await app.inject({ url: '/api/auth/github/callback' })).headers.location).toBe('https://acme.example/?signedIn=1');
    const evil = await app.inject({ url: '/api/auth/github/callback', cookies: { mycota_oauth_return: 'https://evil.example' } });
    expect(evil.headers.location).toBe('https://acme.example/?signedIn=1');
  });
});
