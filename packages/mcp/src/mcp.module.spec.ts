import 'reflect-metadata';
import { createHash } from 'node:crypto';
import cookie from '@fastify/cookie';
import { Global, Module } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { InMemoryOtpStore, MycotaAuthModule, type User, UsersService } from '@bubltec/mycota-auth';
import { DYNAMO_DOC_CLIENT } from '@bubltec/mycota-dynamo';
import { FakeMailer } from '@bubltec/mycota-mail';
import { InMemoryOAuthStore, MycotaOAuthModule } from '@bubltec/mycota-oauth';
import { afterEach, describe, expect, it } from 'vitest';
import { MycotaMcpModule } from './mcp.module.js';
import type { Tool } from './tool.js';

const ALICE: User = { id: '1', provider: 'github', providerAccountId: '1', displayName: 'alice', email: 'alice@acme.example', verifiedContributor: false, createdAt: 'now' };

class FakeUsers {
  async getByProviderAccount(provider: string, id: string) {
    return provider === 'github' && id === '1' ? ALICE : null;
  }
}

@Global()
@Module({ providers: [{ provide: DYNAMO_DOC_CLIENT, useValue: {} }], exports: [DYNAMO_DOC_CLIENT] })
class StubDynamoModule {}

const whoami: Tool = {
  definition: { name: 'whoami', title: 'Who am I', description: 'Attribution.', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  run: async (_args, by) => ({ by }),
};

async function boot(attribution?: (p: any) => string) {
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
        useFactory: () => ({ origin: 'https://acme.example', resourcePath: '/mcp', scope: 'acme', appName: 'Acme', apiPrefix: '', grants: 'x', isAllowed: () => true, store }),
      }),
      MycotaMcpModule.forRootAsync({
        useFactory: () => ({ serverInfo: { name: 'acme', version: '1' }, instructions: 'hi', tools: [whoami], attribution }),
      }),
    ],
  })
    .overrideProvider(UsersService)
    .useValue(new FakeUsers())
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.register(cookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const token = 'access-token';
  await store.putToken({
    tokenHash: createHash('sha256').update(token).digest('base64url'),
    kind: 'access',
    clientId: 'c',
    userKey: 'github:1',
    scope: 'acme',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    createdAt: 'now',
  });
  const call = (payload: unknown, headers: Record<string, string | undefined> = { authorization: `Bearer ${token}` }) =>
    app.inject({ method: 'POST', url: '/mcp', headers: headers as Record<string, string>, payload: payload as never });
  return { app, call };
}

let current: NestFastifyApplication | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe('MycotaMcpModule', () => {
  it('serves tools to a bearer-authenticated user, attributed to them', async () => {
    const { app, call } = await boot();
    current = app;
    const list = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(list.json().result.tools.map((t: any) => t.name)).toEqual(['whoami']);
    const res = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami' } });
    expect(res.json().result.structuredContent).toEqual({ by: 'alice@acme.example (mcp)' });
  });

  it('lets the app choose the attribution', async () => {
    const { app, call } = await boot((p) => `${p.user.displayName} via claude`);
    current = app;
    const res = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami' } });
    expect(res.json().result.structuredContent).toEqual({ by: 'alice via claude' });
  });

  it('answers 401 with the discovery pointer when there is no valid token', async () => {
    const { app, call } = await boot();
    current = app;
    for (const headers of [{} as Record<string, string>, { authorization: 'Bearer nope' }]) {
      const res = await call({ jsonrpc: '2.0', id: 1, method: 'ping' }, headers);
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/mcp');
    }
  });

  it('replies 202 to notifications, and 405 to GET and DELETE', async () => {
    const { app, call } = await boot();
    current = app;
    expect((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).statusCode).toBe(202);
    expect((await app.inject({ method: 'GET', url: '/mcp' })).statusCode).toBe(405);
    expect((await app.inject({ method: 'DELETE', url: '/mcp' })).statusCode).toBe(405);
  });
});
