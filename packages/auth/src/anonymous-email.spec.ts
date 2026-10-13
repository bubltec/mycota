import 'reflect-metadata';
import cookie from '@fastify/cookie';
import { Global, Module, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DYNAMO_DOC_CLIENT } from '@bubltec/mycota-dynamo';
import { FakeMailer, type Mailer } from '@bubltec/mycota-mail';
import { afterEach, describe, expect, it } from 'vitest';
import type { MycotaAuthConfig } from './auth.config.js';
import { MycotaAuthModule } from './auth.module.js';
import { hashAnonymousEmail } from './otp.js';
import { InMemoryOtpStore, type OtpRecord } from './otp.store.js';
import { OtpService } from './otp.service.js';

const PEPPER = 'p'.repeat(40);
const config = (over: Partial<MycotaAuthConfig> = {}): MycotaAuthConfig => ({
  jwtSecret: 'jwt-secret-for-tests',
  webOrigin: 'http://localhost',
  usersTableName: 'users',
  emailFromAddress: 'noreply@test.local',
  stage: 'test',
  appName: 'grtzplz',
  anonymousEmail: { pepper: PEPPER },
  ...over,
});

/** Records every key the store sees, so tests can assert on what would be persisted. */
class SpyOtpStore extends InMemoryOtpStore {
  readonly keys: string[] = [];
  readonly putRecords: OtpRecord[] = [];
  override async put(key: string, record: OtpRecord) {
    this.keys.push(key);
    this.putRecords.push(structuredClone(record));
    return super.put(key, record);
  }
}

function service(over: Partial<MycotaAuthConfig> = {}, mailer: Mailer = new FakeMailer()) {
  const store = new SpyOtpStore();
  return { svc: new OtpService(store, mailer, undefined, config(over)), store, mailer };
}
const lastCode = (m: FakeMailer) => /is: (\d{6})/.exec(m.sent.at(-1)!.text)![1]!;

describe('hashAnonymousEmail', () => {
  it('is deterministic, versioned, and never contains the address', () => {
    const h = hashAnonymousEmail(PEPPER, 'jane@example.com');
    expect(h).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(h).toBe(hashAnonymousEmail(PEPPER, 'jane@example.com'));
    expect(h).not.toContain('jane');
  });
  it('differs by address and by pepper (so a leaked table cannot be checked without the pepper)', () => {
    expect(hashAnonymousEmail(PEPPER, 'a@example.com')).not.toBe(hashAnonymousEmail(PEPPER, 'b@example.com'));
    expect(hashAnonymousEmail(PEPPER, 'a@example.com')).not.toBe(hashAnonymousEmail('q'.repeat(40), 'a@example.com'));
  });
  it('is not a plain hash of the address', async () => {
    const { createHash } = await import('node:crypto');
    const plain = createHash('sha256').update('jane@example.com').digest('hex');
    expect(hashAnonymousEmail(PEPPER, 'jane@example.com')).not.toContain(plain);
  });
});

describe('OtpService anonymous email', () => {
  it('sends the code to the real address but stores only hashed keys', async () => {
    const { svc, store, mailer } = service();
    await svc.requestAnonymousEmail('  Jane.Doe@Example.com ');
    expect((mailer as FakeMailer).sent[0]!.to).toBe('jane.doe@example.com');
    expect(store.keys).toEqual([`email-anon#${hashAnonymousEmail(PEPPER, 'jane.doe@example.com')}`]);
    expect(JSON.stringify([store.keys, store.putRecords])).not.toMatch(/jane|example\.com/i);
  });

  it('confirms with the code and returns the same stable account id however the address is cased', async () => {
    const { svc, mailer } = service();
    await svc.requestAnonymousEmail('Jane@Example.com');
    const id = await svc.confirmAnonymousEmail('jane@example.com', lastCode(mailer as FakeMailer));
    expect(id).toEqual({ accountId: hashAnonymousEmail(PEPPER, 'jane@example.com') });

    const later = service();
    await later.svc.requestAnonymousEmail('JANE@EXAMPLE.COM');
    expect((await later.svc.confirmAnonymousEmail('jane@example.com', lastCode(later.mailer as FakeMailer)))?.accountId).toBe(id!.accountId);
  });

  it('keeps the same limits as ordinary codes: single use, wrong code, cooldown', async () => {
    const { svc, mailer } = service();
    const t0 = 1_000_000;
    await svc.requestAnonymousEmail('a@example.com', t0);
    const code = lastCode(mailer as FakeMailer);
    expect(await svc.confirmAnonymousEmail('a@example.com', code === '000000' ? '111111' : '000000', t0)).toBeUndefined();
    await expect(svc.requestAnonymousEmail('a@example.com', t0 + 1000)).rejects.toThrow('wait a minute');
    expect(await svc.confirmAnonymousEmail('a@example.com', code, t0 + 2000)).toBeDefined();
    expect(await svc.confirmAnonymousEmail('a@example.com', code, t0 + 3000)).toBeUndefined();
  });

  it('does not accept a code issued for the ordinary email channel, nor the reverse', async () => {
    const { svc, mailer } = service();
    await svc.request('email', 'a@example.com');
    expect(await svc.confirmAnonymousEmail('a@example.com', lastCode(mailer as FakeMailer))).toBeUndefined();
    const other = service();
    await other.svc.requestAnonymousEmail('a@example.com');
    expect(await other.svc.confirm('email', 'a@example.com', lastCode(other.mailer as FakeMailer))).toBeUndefined();
  });

  it('is off without config, rejects bad addresses, and never echoes the address in errors', async () => {
    const off = service({ anonymousEmail: undefined });
    expect(off.svc.anonymousEmailEnabled).toBe(false);
    await expect(off.svc.requestAnonymousEmail('a@example.com')).rejects.toThrow('not enabled');
    await expect(service().svc.requestAnonymousEmail('not an email')).rejects.toThrow('Invalid email address');
  });

  it('refuses a weak or reused pepper at boot', () => {
    expect(() => service({ anonymousEmail: { pepper: 'short' } })).toThrow('at least 32');
    expect(() => service({ jwtSecret: PEPPER })).toThrow('must differ from jwtSecret');
  });

  it('keeps the address out of logs and errors when delivery fails', async () => {
    const failing: Mailer = {
      async send(m) {
        throw new Error(`MessageRejected: Email address is not verified: ${String(m.to)}`);
      },
    };
    const { svc } = service({}, failing);
    const err = await svc.requestAnonymousEmail('secret.person@example.com').catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(JSON.stringify([(err as Error).message, (err as { getResponse?: () => unknown }).getResponse?.()])).not.toMatch(/secret\.person|example\.com/i);
    expect((err as { getStatus?: () => number }).getStatus?.()).toBe(502);
  });

  it('exposes test codes only on local/test stages', async () => {
    const t = service({ stage: 'test' });
    await t.svc.requestAnonymousEmail('a@example.com');
    expect(await t.svc.getAnonymousTestCode('a@example.com')).toBe(lastCode(t.mailer as FakeMailer));
    const p = service({ stage: 'prod' });
    await p.svc.requestAnonymousEmail('a@example.com');
    expect(await p.svc.getAnonymousTestCode('a@example.com')).toBeUndefined();
    expect(p.store.putRecords[0]!.testCode).toBeUndefined();
  });
});

// ---- Whole flow over HTTP with the real UsersService and the real DynamoOtpStore ----------------------------

/** A tiny in-memory DynamoDB document client that records everything sent to it. */
class RecordingDocClient {
  readonly items = new Map<string, Record<string, unknown>>();
  readonly commands: unknown[] = [];

  async send(cmd: { constructor: { name: string }; input: Record<string, any> }) {
    this.commands.push(structuredClone(cmd.input));
    const { input } = cmd;
    switch (cmd.constructor.name) {
      case 'PutCommand': {
        const pk = input.Item.PK as string;
        if (input.ConditionExpression?.includes('attribute_not_exists') && this.items.has(pk)) {
          throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
        }
        this.items.set(pk, structuredClone(input.Item));
        return {};
      }
      case 'GetCommand':
        return { Item: this.items.get(input.Key.PK) && structuredClone(this.items.get(input.Key.PK)) };
      case 'DeleteCommand':
        this.items.delete(input.Key.PK);
        return {};
      case 'UpdateCommand': {
        const item = this.items.get(input.Key.PK);
        if (!item) throw Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' });
        if (!input.UpdateExpression.startsWith('ADD attempts')) throw new Error(`unsupported update: ${input.UpdateExpression}`);
        item.attempts = Number(item.attempts ?? 0) + 1;
        return { Attributes: { attempts: item.attempts } };
      }
      default:
        throw new Error(`unsupported command ${cmd.constructor.name}`);
    }
  }
}

describe('anonymous email, end to end (real UsersService + DynamoOtpStore)', () => {
  let app: NestFastifyApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function boot(over: Partial<MycotaAuthConfig> = {}) {
    const db = new RecordingDocClient();
    const mailer = new FakeMailer();
    @Global()
    @Module({ providers: [{ provide: DYNAMO_DOC_CLIENT, useValue: db }], exports: [DYNAMO_DOC_CLIENT] })
    class DynamoStub {}
    const ref = await Test.createTestingModule({
      imports: [DynamoStub, MycotaAuthModule.forRootAsync({ useFactory: () => config(over), mailer: () => mailer })],
    }).compile();
    app = ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie as never);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return { app, db, mailer };
  }

  const post = (a: NestFastifyApplication, url: string, payload: object) => a.inject({ method: 'POST', url, payload });

  it('signs up and back in without ever persisting the address', async () => {
    const { app: a, db, mailer } = await boot();
    const email = 'Very.Secret@Example.COM';

    expect((await post(a, '/auth/anon-email/request', { email })).json()).toEqual({ sent: true });
    const code = lastCode(mailer);
    const first = await post(a, '/auth/anon-email/confirm', { email, code });
    expect(first.statusCode).toBe(201);
    const cookieValue = first.cookies.find((c) => c.name === 'session')!.value;
    expect(cookieValue).toBeTruthy();

    // A later visit: same address, new code, lands on the same account.
    mailer.sent.length = 0;
    const again = await a.inject({ method: 'POST', url: '/auth/anon-email/request', payload: { email: 'very.secret@example.com' } });
    expect(again.statusCode).toBe(201);

    const users = [...db.items.values()].filter((i) => String(i.PK).startsWith('USER#'));
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ provider: 'anon_email', displayName: 'Anonymous' });
    expect(users[0]).not.toHaveProperty('email');
    expect(String(users[0]!.providerAccountId)).toBe(hashAnonymousEmail(PEPPER, 'very.secret@example.com'));

    // The point of the feature: nothing sent to, or kept by, the database contains the address.
    const everything = JSON.stringify([[...db.items.values()], db.commands]);
    expect(everything).not.toMatch(/very\.secret/i);
    expect(everything).not.toMatch(/example\.com/i);
    // ...nor does the session token.
    expect(Buffer.from(cookieValue.split('.')[1]!, 'base64url').toString()).not.toMatch(/very\.secret|example\.com/i);
  });

  it('control: the ordinary email flow does persist the address (so the check above can detect a leak)', async () => {
    const { app: a, db, mailer } = await boot();
    await post(a, '/auth/otp/request', { channel: 'email', identifier: 'plain.person@example.com' });
    await post(a, '/auth/otp/confirm', { channel: 'email', identifier: 'plain.person@example.com', code: lastCode(mailer) });
    expect(JSON.stringify([...db.items.values()])).toMatch(/plain\.person@example\.com/);
  });

  it('answers a wrong code with 401, validates input, and is advertised only when configured', async () => {
    const { app: a } = await boot();
    await post(a, '/auth/anon-email/request', { email: 'a@example.com' });
    expect((await post(a, '/auth/anon-email/confirm', { email: 'a@example.com', code: '000000' })).statusCode).toBe(401);
    expect((await post(a, '/auth/anon-email/request', { email: 'nope' })).statusCode).toBe(400);
    expect((await post(a, '/auth/anon-email/confirm', { email: 'a@example.com', code: 'abcdef' })).statusCode).toBe(400);
    expect((await a.inject({ method: 'GET', url: '/auth/providers' })).json()).toMatchObject({ anonymousEmail: true });
  });

  it('is a 400 and not advertised when no pepper is configured', async () => {
    const { app: a } = await boot({ anonymousEmail: undefined });
    expect((await post(a, '/auth/anon-email/request', { email: 'a@example.com' })).statusCode).toBe(400);
    expect((await a.inject({ method: 'GET', url: '/auth/providers' })).json()).toMatchObject({ anonymousEmail: false });
  });
});
