import 'reflect-metadata';
import cookie from '@fastify/cookie';
import { Global, Module, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DYNAMO_DOC_CLIENT } from '@bubltec/mycota-dynamo';
import { FakeMailer } from '@bubltec/mycota-mail';
import { FakeSmsSender } from '@bubltec/mycota-sms';
import { afterEach, describe, expect, it } from 'vitest';
import type { MycotaAuthConfig } from './auth.config.js';
import { MycotaAuthModule } from './auth.module.js';
import { enablePassportFastifyCompat } from './fastify-passport-compat.js';
import { InMemoryOtpStore } from './otp.store.js';
import { UsersService } from './users.service.js';
import type { User } from './user.types.js';

const baseConfig: MycotaAuthConfig = {
  jwtSecret: 'test-secret',
  webOrigin: 'http://localhost:5173',
  usersTableName: 'users',
  emailFromAddress: 'noreply@test.local',
  stage: 'test',
};

/** Stands in for the consumer's global `DynamoModule`, which provides the doc client. */
@Global()
@Module({ providers: [{ provide: DYNAMO_DOC_CLIENT, useValue: {} }], exports: [DYNAMO_DOC_CLIENT] })
class StubDynamoModule {}

/** Users in memory, so the real controller/OTP/session path runs without DynamoDB. */
class FakeUsers {
  private readonly users = new Map<string, User>();
  async findOrCreateByIdentifier(provider: 'email' | 'phone', id: string): Promise<User> {
    const key = `${provider}#${id}`;
    if (!this.users.has(key)) {
      this.users.set(key, { id: `u_${this.users.size + 1}`, provider, providerAccountId: id, displayName: id, verifiedContributor: false, createdAt: 'now' });
    }
    return this.users.get(key)!;
  }
}

async function boot(config: MycotaAuthConfig, withSms = true) {
  const mailer = new FakeMailer();
  const sms = new FakeSmsSender();
  const moduleRef = await Test.createTestingModule({
    imports: [
      StubDynamoModule,
      MycotaAuthModule.forRootAsync({
        useFactory: () => config,
        mailer: () => mailer,
        ...(withSms ? { smsSender: () => sms } : {}),
        otpStore: () => new InMemoryOtpStore(),
      }),
    ],
  })
    .overrideProvider(UsersService)
    .useValue(new FakeUsers())
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.register(cookie as never);
  enablePassportFastifyCompat(app.getHttpAdapter().getInstance());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, mailer, sms };
}

let current: NestFastifyApplication | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe('MycotaAuthModule', () => {
  it('boots with only the base config (optional providers absent)', async () => {
    const { app } = await boot(baseConfig, false);
    current = app;
    const res = await app.inject({ method: 'GET', url: '/auth/providers' });
    expect(res.json()).toEqual({ github: false, google: false, apple: false, facebook: false, microsoft: false, email: true, phone: false });
  });

  it('404s routes of unconfigured providers instead of a 500', async () => {
    const { app } = await boot(baseConfig);
    current = app;
    for (const url of ['/auth/facebook', '/auth/microsoft', '/auth/apple']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  it('builds the optional strategies when configured and advertises them', async () => {
    const { app } = await boot({
      ...baseConfig,
      facebook: { clientId: 'fb', clientSecret: 's', callbackUrl: 'http://localhost:3100/auth/facebook/callback' },
      microsoft: { clientId: 'ms', clientSecret: 's', callbackUrl: 'http://localhost:3100/auth/microsoft/callback' },
    });
    current = app;
    const providers = (await app.inject({ method: 'GET', url: '/auth/providers' })).json();
    expect(providers).toMatchObject({ facebook: true, microsoft: true, apple: false, phone: true });
    const redirect = await app.inject({ method: 'GET', url: '/auth/facebook' });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toContain('facebook.com');
  });

  it('signs a user in by email code and sets the session cookie', async () => {
    const { app, mailer } = await boot(baseConfig);
    current = app;
    const req = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { channel: 'email', identifier: 'New.User@Gmail.com' } });
    expect(req.json()).toEqual({ sent: true });
    const code = /is: (\d{6})/.exec(mailer.sent[0]!.text)![1]!;

    const wrong = await app.inject({ method: 'POST', url: '/auth/otp/confirm', payload: { channel: 'email', identifier: 'new.user@gmail.com', code: code === '000000' ? '111111' : '000000' } });
    expect(wrong.statusCode).toBe(401);

    const ok = await app.inject({ method: 'POST', url: '/auth/otp/confirm', payload: { channel: 'email', identifier: 'new.user@gmail.com', code } });
    expect(ok.statusCode).toBe(201);
    expect(ok.cookies.find((c) => c.name === 'session')?.value).toBeTruthy();
  });

  it('signs a user in by SMS code', async () => {
    const { app, sms } = await boot(baseConfig);
    current = app;
    await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { channel: 'phone', identifier: '(415) 555-0132' } });
    const code = /is (\d{6})/.exec(sms.sent[0]!.body)![1]!;
    const ok = await app.inject({ method: 'POST', url: '/auth/otp/confirm', payload: { channel: 'phone', identifier: '+14155550132', code } });
    expect(ok.statusCode).toBe(201);
  });

  it('rejects phone sign-in when no SMS sender is configured, and validates input', async () => {
    const { app } = await boot(baseConfig, false);
    current = app;
    const phone = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { channel: 'phone', identifier: '4155550132' } });
    expect(phone.statusCode).toBe(400);
    const badChannel = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { channel: 'carrier-pigeon', identifier: 'x' } });
    expect(badChannel.statusCode).toBe(400);
    const badCode = await app.inject({ method: 'POST', url: '/auth/otp/confirm', payload: { channel: 'email', identifier: 'a@b.co', code: 'abcdef' } });
    expect(badCode.statusCode).toBe(400);
  });

  it('exposes test codes only on local/test stages', async () => {
    const t = await boot(baseConfig);
    current = t.app;
    await t.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { channel: 'email', identifier: 'a@example.com' } });
    const hit = await t.app.inject({ method: 'GET', url: '/auth/otp/test-code?channel=email&identifier=a@example.com' });
    expect(hit.json().code).toMatch(/^\d{6}$/);
    await t.app.close();

    const p = await boot({ ...baseConfig, stage: 'prod' });
    current = p.app;
    await p.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { channel: 'email', identifier: 'a@example.com' } });
    expect((await p.app.inject({ method: 'GET', url: '/auth/otp/test-code?channel=email&identifier=a@example.com' })).statusCode).toBe(404);
  });
});
