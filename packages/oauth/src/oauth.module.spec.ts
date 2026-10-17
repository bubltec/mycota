import 'reflect-metadata';
import { createHash } from 'node:crypto';
import cookie from '@fastify/cookie';
import { Controller, Get, Global, Module, UseGuards, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthService, InMemoryOtpStore, MycotaAuthModule, type User, UsersService } from '@bubltec/mycota-auth';
import { DYNAMO_DOC_CLIENT } from '@bubltec/mycota-dynamo';
import { FakeMailer } from '@bubltec/mycota-mail';
import { afterEach, describe, expect, it } from 'vitest';
import { OAuthBearerGuard } from './oauth-bearer.js';
import { MycotaOAuthModule } from './oauth.module.js';
import { InMemoryOAuthStore } from './oauth.store.js';
import { registerOAuthWellKnown } from './well-known.js';

const REDIRECT = 'https://client.example/callback';
const VERIFIER = 'a-long-random-verifier-string-that-is-at-least-43-chars-long';
const challenge = createHash('sha256').update(VERIFIER).digest('base64url');

const mk = (id: string, email: string): User => ({ id, provider: 'github', providerAccountId: id, displayName: id, email, verifiedContributor: false, createdAt: 'now' });
const ALICE = mk('1', 'alice@acme.example');
const BOB = mk('2', 'bob@acme.example');

/** Users in memory, so the real session and bearer path runs without DynamoDB. */
class FakeUsers {
  private readonly users = new Map([ALICE, BOB].map((u) => [`${u.provider}:${u.providerAccountId}`, u]));
  async getByProviderAccount(provider: string, id: string) {
    return this.users.get(`${provider}:${id}`) ?? null;
  }
  async findOrCreateByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email)!;
  }
}

@Global()
@Module({ providers: [{ provide: DYNAMO_DOC_CLIENT, useValue: {} }], exports: [DYNAMO_DOC_CLIENT] })
class StubDynamoModule {}

/** Stands in for the protected resource, such as an MCP endpoint. */
@Controller('mcp')
@UseGuards(OAuthBearerGuard)
class ResourceController {
  @Get()
  whoami() {
    return { ok: true };
  }
}

async function boot() {
  const state = { aliceAllowed: true };
  const store = new InMemoryOAuthStore();
  const moduleRef = await Test.createTestingModule({
    imports: [
      StubDynamoModule,
      MycotaAuthModule.forRootAsync({
        useFactory: () => ({ jwtSecret: 's', webOrigin: 'http://localhost', usersTableName: 'u', emailFromAddress: 'a@b.c', stage: 'test' }),
        mailer: () => new FakeMailer(),
        otpStore: () => new InMemoryOtpStore(),
      }),
      MycotaOAuthModule.forRootAsync({
        useFactory: () => ({
          origin: 'https://acme.example',
          resourcePath: '/mcp',
          scope: 'acme',
          appName: 'Acme',
          apiPrefix: '',
          grants: 'read and edit entries',
          signIn: [{ label: 'Sign in with GitHub', href: '/auth/github' }],
          localSignInEmail: 'alice@acme.example',
          isAllowed: (u: User) => state.aliceAllowed && u.email === ALICE.email,
          store,
        }),
      }),
    ],
    controllers: [ResourceController],
  })
    .overrideProvider(UsersService)
    .useValue(new FakeUsers())
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.register(cookie as never);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  const fastify = app.getHttpAdapter().getInstance();
  registerOAuthWellKnown(fastify, { origin: 'https://acme.example', resourcePath: '/mcp', scope: 'acme', appName: 'Acme' });
  await app.init();
  await fastify.ready();
  const session = (u: User) => `session=${app.get(AuthService).issueSessionToken(u)}`;
  return { app, session, state };
}

let current: NestFastifyApplication | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe('MycotaOAuthModule', () => {
  it('runs the whole flow: register, consent, token, bearer access, refresh', async () => {
    const { app, session } = await boot();
    current = app;

    const registered = (await app.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'Claude', redirect_uris: [REDIRECT] } })).json();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: registered.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
    });

    // Signed out: sign-in page, with a return cookie so the flow resumes.
    const signedOut = await app.inject({ url: `/oauth/authorize?${query}` });
    expect(signedOut.body).toContain('Sign in with GitHub');
    expect(String(signedOut.headers['set-cookie'])).toContain('mycota_oauth_return=');

    // Signed in but not allowed.
    expect((await app.inject({ url: `/oauth/authorize?${query}`, headers: { cookie: session(BOB) } })).statusCode).toBe(403);

    // Allowed: consent page naming the grant.
    const consent = await app.inject({ url: `/oauth/authorize?${query}`, headers: { cookie: session(ALICE) } });
    expect(consent.body).toContain('asking to read and edit entries');

    // Not allowed users can't post a decision either.
    const posted = (user: User, decision: string) =>
      app.inject({ method: 'POST', url: '/oauth/authorize', headers: { cookie: session(user) }, payload: { ...Object.fromEntries(query), decision } });
    expect((await posted(BOB, 'allow')).statusCode).toBe(403);

    const denied = new URL((await posted(ALICE, 'deny')).headers.location as string);
    expect(denied.searchParams.get('error')).toBe('access_denied');

    const allowed = new URL((await posted(ALICE, 'allow')).headers.location as string);
    expect(allowed.searchParams.get('state')).toBe('xyz');
    expect(allowed.searchParams.get('iss')).toBe('https://acme.example');

    const tokens = (
      await app.inject({
        method: 'POST',
        url: '/oauth/token',
        payload: { grant_type: 'authorization_code', client_id: registered.client_id, code: allowed.searchParams.get('code'), code_verifier: VERIFIER, redirect_uri: REDIRECT },
      })
    ).json();
    expect(tokens).toMatchObject({ token_type: 'Bearer', scope: 'acme' });

    // The protected resource: 401 with a discovery pointer without a token, 200 with one.
    const unauth = await app.inject({ url: '/mcp' });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.headers['www-authenticate']).toBe('Bearer resource_metadata="https://acme.example/.well-known/oauth-protected-resource/mcp", scope="acme"');
    expect((await app.inject({ url: '/mcp', headers: { authorization: `Bearer ${tokens.access_token}` } })).json()).toEqual({ ok: true });

    const refreshed = (
      await app.inject({ method: 'POST', url: '/oauth/token', payload: { grant_type: 'refresh_token', client_id: registered.client_id, refresh_token: tokens.refresh_token } })
    ).json();
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    const reused = await app.inject({ method: 'POST', url: '/oauth/token', payload: { grant_type: 'refresh_token', client_id: registered.client_id, refresh_token: tokens.refresh_token } });
    expect(reused.statusCode).toBe(400);
    expect(reused.json().error).toBe('invalid_grant');
  });

  it('rejects an existing token once the user is no longer allowed', async () => {
    const { app, session, state } = await boot();
    current = app;
    const registered = (await app.inject({ method: 'POST', url: '/oauth/register', payload: { redirect_uris: [REDIRECT] } })).json();
    const form = { response_type: 'code', client_id: registered.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', decision: 'allow' };
    const code = new URL((await app.inject({ method: 'POST', url: '/oauth/authorize', headers: { cookie: session(ALICE) }, payload: form })).headers.location as string).searchParams.get('code');
    const tokens = (await app.inject({ method: 'POST', url: '/oauth/token', payload: { grant_type: 'authorization_code', client_id: registered.client_id, code, code_verifier: VERIFIER } })).json();
    const call = () => app.inject({ url: '/mcp', headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect((await call()).statusCode).toBe(200);
    state.aliceAllowed = false;
    expect((await call()).statusCode).toBe(401);
  });

  it('serves local sign-in only when configured', async () => {
    const { app } = await boot();
    current = app;
    const res = await app.inject({ method: 'POST', url: '/oauth/local-sign-in' });
    expect(res.statusCode).toBe(302);
    expect(String(res.headers['set-cookie'])).toContain('session=');
  });
});
