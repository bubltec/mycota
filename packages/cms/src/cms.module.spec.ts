import 'reflect-metadata';
import cookie from '@fastify/cookie';
import { type CanActivate, type ExecutionContext, Global, Injectable, Module, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { InMemoryOtpStore, MycotaAuthModule } from '@bubltec/mycota-auth';
import { DYNAMO_DOC_CLIENT } from '@bubltec/mycota-dynamo';
import { FakeMailer } from '@bubltec/mycota-mail';
import { afterEach, describe, expect, it } from 'vitest';
import { MycotaCmsModule } from './cms.module.js';
import { ContentService } from './content.service.js';
import { commentSpec, pinSpec, postSpec } from './fixture.testing.js';
import { InMemoryContentStore } from './store.js';

@Global()
@Module({ providers: [{ provide: DYNAMO_DOC_CLIENT, useValue: {} }], exports: [DYNAMO_DOC_CLIENT] })
class StubDynamoModule {}

/** Lets a request through only if it says `x-editor`, as whoever it names. */
@Injectable()
class HeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>();
    const name = request.headers['x-editor'];
    if (!name) return false;
    request.user = { displayName: name };
    return true;
  }
}

async function boot(attribution?: (u: any) => string) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      StubDynamoModule,
      MycotaAuthModule.forRootAsync({
        useFactory: () => ({ jwtSecret: 's', webOrigin: 'http://localhost', usersTableName: 'u', emailFromAddress: 'a@b.c', stage: 'test' }),
        mailer: () => new FakeMailer(),
        otpStore: () => new InMemoryOtpStore(),
      }),
      MycotaCmsModule.forRootAsync({
        entities: [postSpec, commentSpec, pinSpec],
        guard: HeaderGuard,
        attribution,
        useFactory: () => ({ store: (registry) => new InMemoryContentStore(registry) }),
      }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.register(cookie as never);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const as = { 'x-editor': 'ed' };
  return { app, as, content: app.get(ContentService) };
}

let current: NestFastifyApplication | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe('MycotaCmsModule', () => {
  it('serves editor endpoints for roots and nested children, behind the guard', async () => {
    const { app, as, content } = await boot();
    current = app;
    expect((await app.inject({ method: 'POST', url: '/posts', payload: { title: 'Hello world', body: 'b' } })).statusCode).toBe(403);

    const created = await app.inject({ method: 'POST', url: '/posts', headers: as, payload: { title: 'Hello world', body: 'b' } });
    expect(created.json()).toMatchObject({ id: 'hello-world', status: 'draft', comments: [] });
    expect((await content.find('post', 'hello-world')).updatedBy).toBe('ed');

    const child = await app.inject({ method: 'POST', url: '/posts/hello-world/comments', headers: as, payload: { text: 'hi' } });
    expect(child.json().comments).toHaveLength(1);

    const updated = await app.inject({ method: 'PUT', url: '/posts/hello-world', headers: as, payload: { title: 'Hello', body: 'new' } });
    expect(updated.json()).toMatchObject({ title: 'Hello', body: 'new' });

    const commentId = child.json().comments[0].id;
    const removedChild = await app.inject({ method: 'DELETE', url: `/posts/hello-world/comments/${commentId}`, headers: as });
    expect(removedChild.json().comments).toEqual([]);
  });

  it('validates bodies with the spec’s DTO, and strips nothing silently', async () => {
    const { app, as } = await boot();
    current = app;
    const res = await app.inject({ method: 'POST', url: '/posts', headers: as, payload: { title: 'x', body: 'b', extra: 1 } });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toMatch(/title|extra/);
  });

  it('publishes, and deletes roots with 204', async () => {
    const { app, as } = await boot();
    current = app;
    await app.inject({ method: 'POST', url: '/posts', headers: as, payload: { title: 'Hello world', body: 'b' } });
    await app.inject({ method: 'POST', url: '/posts/hello-world/comments', headers: as, payload: { text: 'hi' } });
    const published = await app.inject({ method: 'POST', url: '/posts/hello-world/publish', headers: as, payload: {} });
    expect(published.json()).toMatchObject({ status: 'published' });
    expect(published.json().comments[0].status).toBe('published');
    expect((await app.inject({ method: 'DELETE', url: '/posts/hello-world', headers: as })).statusCode).toBe(204);
    expect((await app.inject({ method: 'PUT', url: '/posts/hello-world', headers: as, payload: { title: 'Hello', body: 'b' } })).statusCode).toBe(404);
  });

  it('records edits under the app’s attribution', async () => {
    const { app, as, content } = await boot((u) => `${u.displayName}@example.com`);
    current = app;
    await app.inject({ method: 'POST', url: '/posts', headers: as, payload: { title: 'Hello world', body: 'b' } });
    expect((await content.find('post', 'hello-world')).updatedBy).toBe('ed@example.com');
  });

  it('refuses a registry with a duplicate or orphaned entity', async () => {
    const { EntityRegistry } = await import('./registry.js');
    expect(() => new EntityRegistry([postSpec, postSpec])).toThrow(/twice/);
    expect(() => new EntityRegistry([commentSpec])).toThrow(/unregistered parent/);
  });
});
