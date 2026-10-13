import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Mailer } from '@bubltec/mycota-mail';
import type { SmsSender } from '@bubltec/mycota-sms';
import { MYCOTA_AUTH_CONFIG, type MycotaAuthConfig } from './auth.config.js';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_RESEND_COOLDOWN_MS,
  OTP_SEND_WINDOW_MS,
  OTP_TTL_MS,
  generateCode,
  hashCode,
  normalizeIdentifier,
  safeEqualHex,
  type OtpChannel,
} from './otp.js';
import type { OtpStore } from './otp.store.js';

export const MYCOTA_AUTH_OTP_STORE = Symbol('MYCOTA_AUTH_OTP_STORE');
export const MYCOTA_AUTH_MAILER = Symbol('MYCOTA_AUTH_MAILER');
export const MYCOTA_AUTH_SMS_SENDER = Symbol('MYCOTA_AUTH_SMS_SENDER');

/** Plaintext codes are only retrievable on these stages. Unset or unknown stages are treated as production. */
const TEST_STAGES = new Set(['local', 'test']);

export interface ConfirmedIdentity {
  channel: OtpChannel;
  /** Lowercase email or E.164 phone. */
  identifier: string;
}

/**
 * Passwordless sign-in by one-time code over email or SMS. Unlike
 * `EmailCodeService` (organizational-email verification), this accepts any
 * address, does no domain screening or classification, and leaves no
 * professional-verification state.
 *
 * Request and confirm are the same flow for new and returning users, so
 * neither response reveals whether an account exists.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(MYCOTA_AUTH_OTP_STORE) private readonly store: OtpStore,
    @Inject(MYCOTA_AUTH_MAILER) private readonly mailer: Mailer,
    @Inject(MYCOTA_AUTH_SMS_SENDER) private readonly sms: SmsSender | undefined,
    @Inject(MYCOTA_AUTH_CONFIG) private readonly config: MycotaAuthConfig,
  ) {}

  get phoneEnabled(): boolean {
    return this.sms !== undefined;
  }

  async request(channel: OtpChannel, rawIdentifier: string, now = Date.now()): Promise<void> {
    if (channel === 'phone' && !this.sms) throw new BadRequestException('Phone sign-in is not enabled');
    const identifier = normalizeIdentifier(channel, rawIdentifier);
    if (!identifier) throw new BadRequestException(channel === 'email' ? 'Invalid email address' : 'Invalid phone number');

    const key = `${channel}#${identifier}`;
    const existing = await this.store.get(key);
    if (existing && now - existing.issuedAt < OTP_RESEND_COOLDOWN_MS) {
      throw new HttpException('Please wait a minute before requesting another code.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const inWindow = existing !== undefined && now - existing.windowStart < OTP_SEND_WINDOW_MS;
    const sendCount = inWindow ? existing.sendCount : 0;
    if (sendCount >= OTP_MAX_SENDS_PER_WINDOW) {
      throw new HttpException('Too many codes requested. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = generateCode();
    await this.store.put(key, {
      codeHash: hashCode(this.config.jwtSecret, channel, identifier, code),
      issuedAt: now,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      windowStart: inWindow ? existing.windowStart : now,
      sendCount: sendCount + 1,
      ...(this.testCodesEnabled ? { testCode: code } : {}),
    });

    await this.deliver(channel, identifier, code);
  }

  /** Returns the verified identity, or undefined for a wrong, expired or exhausted code. */
  async confirm(channel: OtpChannel, rawIdentifier: string, code: string, now = Date.now()): Promise<ConfirmedIdentity | undefined> {
    const identifier = normalizeIdentifier(channel, rawIdentifier);
    if (!identifier || !/^\d{6}$/.test(code)) return undefined;
    const key = `${channel}#${identifier}`;

    const record = await this.store.get(key);
    if (!record || record.expiresAt < now) return undefined;
    // Count the attempt before comparing, so concurrent guesses all consume budget.
    const attempts = await this.store.recordAttempt(key);
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.store.delete(key);
      return undefined;
    }
    if (!safeEqualHex(record.codeHash, hashCode(this.config.jwtSecret, channel, identifier, code))) return undefined;

    await this.store.delete(key);
    return { channel, identifier };
  }

  /** E2E only; returns undefined unless the stage is explicitly `local` or `test`. */
  async getTestCode(channel: OtpChannel, rawIdentifier: string): Promise<string | undefined> {
    if (!this.testCodesEnabled) return undefined;
    const identifier = normalizeIdentifier(channel, rawIdentifier);
    if (!identifier) return undefined;
    return (await this.store.get(`${channel}#${identifier}`))?.testCode;
  }

  private get testCodesEnabled(): boolean {
    return this.config.stage !== undefined && TEST_STAGES.has(this.config.stage);
  }

  private async deliver(channel: OtpChannel, identifier: string, code: string): Promise<void> {
    const minutes = OTP_TTL_MS / 60_000;
    const brand = this.config.appName ? `${this.config.appName} ` : '';
    if (channel === 'email') {
      await this.mailer.send({
        to: identifier,
        subject: `Your ${brand}sign-in code`,
        text: `Your ${brand}sign-in code is: ${code}\n\nIt expires in ${minutes} minutes. If you didn't request it, you can ignore this email.`,
      });
      return;
    }
    await this.sms!.send({
      to: identifier,
      body: `Your ${brand}sign-in code is ${code}. It expires in ${minutes} minutes.`,
    });
  }
}
