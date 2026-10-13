import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { toE164 } from '@bubltec/mycota-sms';

export type OtpChannel = 'email' | 'phone';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
/** Sends allowed per identifier per rolling window; bounds SMS/SES spend from one target. */
export const OTP_MAX_SENDS_PER_WINDOW = 5;
export const OTP_SEND_WINDOW_MS = 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const E164_RE = /^\+[1-9]\d{7,14}$/;

/** Returns the canonical identifier (lowercase email / E.164 phone), or undefined if invalid. */
export function normalizeIdentifier(channel: OtpChannel, raw: string): string | undefined {
  const value = raw.trim();
  if (channel === 'email') {
    const email = value.toLowerCase();
    return email.length <= 254 && EMAIL_RE.test(email) ? email : undefined;
  }
  const phone = toE164(value);
  return E164_RE.test(phone) ? phone : undefined;
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** HMAC rather than a bare hash: a 6-digit code is trivially brute-forced from an unkeyed hash. */
export function hashCode(secret: string, channel: string, identifier: string, code: string): string {
  return createHmac('sha256', secret).update(`${channel}\n${identifier}\n${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function maskPhone(e164: string): string {
  return `•••• ${e164.slice(-4)}`;
}

/** Store/hash label for the anonymous-email flow, kept apart from the ordinary `email` channel. */
export const ANON_EMAIL_CHANNEL = 'email-anon';
export const ANON_PEPPER_MIN_LENGTH = 32;

/**
 * The only form in which an anonymous account's email is ever stored: a keyed
 * hash. A plain hash would not do, because email addresses are guessable and an
 * unkeyed hash could be reversed from a leaked database by trying likely
 * addresses. The `pepper` is a secret held outside the database (SSM), so the
 * data alone is not enough to test a guess.
 *
 * The `v1:` prefix leaves room to rotate the pepper later without ambiguity.
 * `email` must already be normalized (lowercase, trimmed).
 */
export function hashAnonymousEmail(pepper: string, email: string): string {
  return `v1:${createHmac('sha256', pepper).update(`mycota:anon-email:v1\n${email}`).digest('hex')}`;
}
