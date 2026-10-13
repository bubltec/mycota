import { HttpException } from '@nestjs/common';
import { FakeMailer } from '@bubltec/mycota-mail';
import { FakeSmsSender } from '@bubltec/mycota-sms';
import { describe, expect, it } from 'vitest';
import type { MycotaAuthConfig } from './auth.config.js';
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS, normalizeIdentifier } from './otp.js';
import { InMemoryOtpStore } from './otp.store.js';
import { OtpService } from './otp.service.js';

const config = (stage?: string): MycotaAuthConfig => ({
  jwtSecret: 'secret',
  webOrigin: 'http://localhost',
  usersTableName: 't',
  emailFromAddress: 'a@b.c',
  stage,
  appName: 'grtzplz',
});

/** `stage: null` means the app never set one (distinct from omitting the argument, which defaults to `local`). */
function setup(stage: string | null = 'local', withSms = true) {
  const store = new InMemoryOtpStore();
  const mailer = new FakeMailer();
  const sms = withSms ? new FakeSmsSender() : undefined;
  const svc = new OtpService(store, mailer, sms, config(stage ?? undefined));
  const lastEmailCode = () => /is: (\d{6})/.exec(mailer.sent.at(-1)!.text)![1]!;
  const lastSmsCode = () => /is (\d{6})/.exec(sms!.sent.at(-1)!.body)![1]!;
  return { svc, store, mailer, sms, lastEmailCode, lastSmsCode };
}

describe('normalizeIdentifier', () => {
  it('lowercases emails and normalizes US phones', () => {
    expect(normalizeIdentifier('email', '  Jane@Example.COM ')).toBe('jane@example.com');
    expect(normalizeIdentifier('phone', '(415) 555-0132')).toBe('+14155550132');
  });
  it.each([['email', 'nope'], ['email', 'a b@c.com'], ['phone', '123'], ['phone', 'abc']] as const)('rejects %s %s', (c, v) =>
    expect(normalizeIdentifier(c, v)).toBeUndefined(),
  );
});

describe('OtpService', () => {
  it('signs in a free-mail address with an emailed code (no org screening)', async () => {
    const { svc, lastEmailCode, mailer } = setup();
    await svc.request('email', 'Someone@gmail.com');
    expect(mailer.sent[0]!.subject).toContain('grtzplz');
    expect(await svc.confirm('email', 'someone@gmail.com', lastEmailCode())).toEqual({ channel: 'email', identifier: 'someone@gmail.com' });
  });

  it('signs in by SMS with a normalized number', async () => {
    const { svc, sms, lastSmsCode } = setup();
    await svc.request('phone', '415-555-0132');
    expect(sms!.sent[0]!.to).toBe('+14155550132');
    expect(await svc.confirm('phone', '+1 (415) 555-0132', lastSmsCode())).toEqual({ channel: 'phone', identifier: '+14155550132' });
  });

  it('refuses phone when no SmsSender is configured', async () => {
    const { svc } = setup('local', false);
    await expect(svc.request('phone', '4155550132')).rejects.toThrow('not enabled');
    expect(svc.phoneEnabled).toBe(false);
  });

  it('codes are single use', async () => {
    const { svc, lastEmailCode } = setup();
    await svc.request('email', 'a@example.com');
    const code = lastEmailCode();
    expect(await svc.confirm('email', 'a@example.com', code)).toBeDefined();
    expect(await svc.confirm('email', 'a@example.com', code)).toBeUndefined();
  });

  it('rejects wrong and expired codes', async () => {
    const { svc, lastEmailCode } = setup();
    const t0 = 1_000_000;
    await svc.request('email', 'a@example.com', t0);
    const code = lastEmailCode();
    expect(await svc.confirm('email', 'a@example.com', code === '000000' ? '111111' : '000000', t0)).toBeUndefined();
    expect(await svc.confirm('email', 'a@example.com', code, t0 + OTP_TTL_MS + 1)).toBeUndefined();
  });

  it('locks out after too many attempts, even with the right code', async () => {
    const { svc, lastEmailCode } = setup();
    await svc.request('email', 'a@example.com');
    const code = lastEmailCode();
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) expect(await svc.confirm('email', 'a@example.com', wrong)).toBeUndefined();
    expect(await svc.confirm('email', 'a@example.com', code)).toBeUndefined();
  });

  it('counts concurrent guesses against the attempt budget', async () => {
    const { svc, lastEmailCode } = setup();
    await svc.request('email', 'a@example.com');
    const code = lastEmailCode();
    const wrong = code === '123456' ? '654321' : '123456';
    await Promise.all(Array.from({ length: OTP_MAX_ATTEMPTS + 3 }, () => svc.confirm('email', 'a@example.com', wrong)));
    expect(await svc.confirm('email', 'a@example.com', code)).toBeUndefined();
  });

  it('enforces the resend cooldown and an hourly send cap', async () => {
    const { svc } = setup();
    const t0 = 5_000_000;
    await svc.request('email', 'a@example.com', t0);
    await expect(svc.request('email', 'a@example.com', t0 + 1000)).rejects.toBeInstanceOf(HttpException);
    let t = t0;
    for (let i = 0; i < 4; i++) {
      t += OTP_RESEND_COOLDOWN_MS + 1;
      await svc.request('email', 'a@example.com', t);
    }
    t += OTP_RESEND_COOLDOWN_MS + 1;
    await expect(svc.request('email', 'a@example.com', t)).rejects.toThrow('Too many codes');
  });

  it('a new request invalidates the previous code', async () => {
    const { svc, lastEmailCode } = setup();
    const t0 = 9_000_000;
    await svc.request('email', 'a@example.com', t0);
    const first = lastEmailCode();
    await svc.request('email', 'a@example.com', t0 + OTP_RESEND_COOLDOWN_MS + 1);
    const second = lastEmailCode();
    if (first !== second) expect(await svc.confirm('email', 'a@example.com', first, t0 + OTP_RESEND_COOLDOWN_MS + 2)).toBeUndefined();
    expect(await svc.confirm('email', 'a@example.com', second, t0 + OTP_RESEND_COOLDOWN_MS + 2)).toBeDefined();
  });

  it('keys codes per channel and identifier', async () => {
    const { svc, lastEmailCode } = setup();
    await svc.request('email', 'a@example.com');
    expect(await svc.confirm('email', 'b@example.com', lastEmailCode())).toBeUndefined();
  });

  describe('test codes', () => {
    it.each(['local', 'test'])('are available on stage %s', async (stage) => {
      const { svc, lastEmailCode } = setup(stage);
      await svc.request('email', 'a@example.com');
      expect(await svc.getTestCode('email', 'a@example.com')).toBe(lastEmailCode());
    });
    it.each([['prod'], ['dev'], [null]])('are never stored or returned on stage %s', async (stage) => {
      const { svc, store } = setup(stage);
      await svc.request('email', 'a@example.com');
      expect(await svc.getTestCode('email', 'a@example.com')).toBeUndefined();
      expect((await store.get('email#a@example.com'))!.testCode).toBeUndefined();
    });
  });
});
