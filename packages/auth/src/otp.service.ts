import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Mailer } from '@bubltec/mycota-mail';
import type { SmsSender } from '@bubltec/mycota-sms';
import { MYCOTA_AUTH_CONFIG, type MycotaAuthConfig } from './auth.config.js';
import {
  ANON_EMAIL_CHANNEL,
  ANON_PEPPER_MIN_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_RESEND_COOLDOWN_MS,
  OTP_SEND_WINDOW_MS,
  OTP_TTL_MS,
  generateCode,
  hashAnonymousEmail,
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

export interface ConfirmedAnonymousIdentity {
  /** `v1:<hmac>` of the email. The address itself is not available, here or anywhere after this call. */
  accountId: string;
}

/**
 * Passwordless sign-in by one-time code over email or SMS. Unlike
 * `EmailCodeService` (organizational-email verification), this accepts any
 * address, does no domain screening or classification, and leaves no
 * professional-verification state.
 *
 * Request and confirm are the same flow for new and returning users, so
 * neither response reveals whether an account exists.
 *
 * The anonymous-email variant runs the same flow, but everything that is
 * stored (the pending code, its rate-limit counters, and later the account)
 * is keyed by an HMAC of the address; the address exists only in memory long
 * enough to send the code.
 */
@Injectable()
export class OtpService {
  private readonly log = new Logger(OtpService.name);

  constructor(
    @Inject(MYCOTA_AUTH_OTP_STORE) private readonly store: OtpStore,
    @Inject(MYCOTA_AUTH_MAILER) private readonly mailer: Mailer,
    @Inject(MYCOTA_AUTH_SMS_SENDER) private readonly sms: SmsSender | undefined,
    @Inject(MYCOTA_AUTH_CONFIG) private readonly config: MycotaAuthConfig,
  ) {
    const pepper = config.anonymousEmail?.pepper;
    if (pepper !== undefined) {
      // Fail at boot: a weak or reused pepper would quietly undo the point of hashing.
      if (pepper.length < ANON_PEPPER_MIN_LENGTH) {
        throw new Error(`anonymousEmail.pepper must be at least ${ANON_PEPPER_MIN_LENGTH} characters`);
      }
      if (pepper === config.jwtSecret) throw new Error('anonymousEmail.pepper must differ from jwtSecret');
    }
  }

  get phoneEnabled(): boolean {
    return this.sms !== undefined;
  }

  get anonymousEmailEnabled(): boolean {
    return this.config.anonymousEmail !== undefined;
  }

  async request(channel: OtpChannel, rawIdentifier: string, now = Date.now()): Promise<void> {
    if (channel === 'phone' && !this.sms) throw new BadRequestException('Phone sign-in is not enabled');
    const identifier = normalizeIdentifier(channel, rawIdentifier);
    if (!identifier) throw new BadRequestException(channel === 'email' ? 'Invalid email address' : 'Invalid phone number');
    await this.issue(channel, identifier, (code) => this.deliver(channel, identifier, code), now);
  }

  /** Returns the verified identity, or undefined for a wrong, expired or exhausted code. */
  async confirm(channel: OtpChannel, rawIdentifier: string, code: string, now = Date.now()): Promise<ConfirmedIdentity | undefined> {
    const identifier = normalizeIdentifier(channel, rawIdentifier);
    if (!identifier || !(await this.check(channel, identifier, code, now))) return undefined;
    return { channel, identifier };
  }

  /** E2E only; returns undefined unless the stage is explicitly `local` or `test`. */
  async getTestCode(channel: OtpChannel, rawIdentifier: string): Promise<string | undefined> {
    if (!this.testCodesEnabled) return undefined;
    const identifier = normalizeIdentifier(channel, rawIdentifier);
    if (!identifier) return undefined;
    return (await this.store.get(`${channel}#${identifier}`))?.testCode;
  }

  async requestAnonymousEmail(rawEmail: string, now = Date.now()): Promise<void> {
    const { email, id } = this.anonymousId(rawEmail);
    await this.issue(ANON_EMAIL_CHANNEL, id, (code) => this.deliverAnonymous(email, code), now);
  }

  async confirmAnonymousEmail(rawEmail: string, code: string, now = Date.now()): Promise<ConfirmedAnonymousIdentity | undefined> {
    const { id } = this.anonymousId(rawEmail);
    return (await this.check(ANON_EMAIL_CHANNEL, id, code, now)) ? { accountId: id } : undefined;
  }

  /** E2E only; same gating as `getTestCode`. */
  async getAnonymousTestCode(rawEmail: string): Promise<string | undefined> {
    if (!this.testCodesEnabled || !this.anonymousEmailEnabled) return undefined;
    const email = normalizeIdentifier('email', rawEmail);
    if (!email) return undefined;
    const { id } = this.anonymousId(email);
    return (await this.store.get(`${ANON_EMAIL_CHANNEL}#${id}`))?.testCode;
  }

  /** Normalizes and hashes. Throws 400 if the feature is off or the address is invalid; never echoes the address. */
  private anonymousId(rawEmail: string): { email: string; id: string } {
    const pepper = this.config.anonymousEmail?.pepper;
    if (!pepper) throw new BadRequestException('Anonymous email sign-in is not enabled');
    const email = normalizeIdentifier('email', rawEmail);
    if (!email) throw new BadRequestException('Invalid email address');
    return { email, id: hashAnonymousEmail(pepper, email) };
  }

  /**
   * Shared by every channel. `id` is what is stored and hashed against: the
   * address/number itself for ordinary channels, an HMAC for anonymous email.
   */
  private async issue(channel: string, id: string, send: (code: string) => Promise<void>, now: number): Promise<void> {
    const key = `${channel}#${id}`;
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
      codeHash: hashCode(this.config.jwtSecret, channel, id, code),
      issuedAt: now,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      windowStart: inWindow ? existing.windowStart : now,
      sendCount: sendCount + 1,
      ...(this.testCodesEnabled ? { testCode: code } : {}),
    });

    await send(code);
  }

  private async check(channel: string, id: string, code: string, now: number): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const key = `${channel}#${id}`;
    const record = await this.store.get(key);
    if (!record || record.expiresAt < now) return false;
    // Count the attempt before comparing, so concurrent guesses all consume budget.
    const attempts = await this.store.recordAttempt(key);
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.store.delete(key);
      return false;
    }
    if (!safeEqualHex(record.codeHash, hashCode(this.config.jwtSecret, channel, id, code))) return false;
    await this.store.delete(key);
    return true;
  }

  private get testCodesEnabled(): boolean {
    return this.config.stage !== undefined && TEST_STAGES.has(this.config.stage);
  }

  private get brand(): string {
    return this.config.appName ? `${this.config.appName} ` : '';
  }

  private async deliver(channel: OtpChannel, identifier: string, code: string): Promise<void> {
    const minutes = OTP_TTL_MS / 60_000;
    if (channel === 'email') {
      await this.mailer.send({
        to: identifier,
        subject: `Your ${this.brand}sign-in code`,
        text: `Your ${this.brand}sign-in code is: ${code}\n\nIt expires in ${minutes} minutes. If you didn't request it, you can ignore this email.`,
      });
      return;
    }
    await this.sms!.send({
      to: identifier,
      body: `Your ${this.brand}sign-in code is ${code}. It expires in ${minutes} minutes.`,
    });
  }

  private async deliverAnonymous(email: string, code: string): Promise<void> {
    const minutes = OTP_TTL_MS / 60_000;
    try {
      await this.mailer.send({
        to: email,
        subject: `Your ${this.brand}sign-in code`,
        text:
          `Your ${this.brand}sign-in code is: ${code}\n\nIt expires in ${minutes} minutes. ` +
          `Your email address is not stored with your account, so keep access to this inbox: ` +
          `it is the only way back in. If you didn't request this, ignore this email.`,
      });
    } catch (err) {
      // Mail-provider errors routinely quote the recipient. Log only the error class, never its message,
      // and give the caller a generic failure, so the address cannot reach logs or responses this way.
      this.log.error(`anonymous code delivery failed (${err instanceof Error ? err.name : 'unknown'})`);
      throw new HttpException('Could not send the code. Try again later.', HttpStatus.BAD_GATEWAY);
    }
  }
}
