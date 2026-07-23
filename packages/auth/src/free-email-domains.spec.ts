import { describe, expect, it } from 'vitest';
import { isFreeEmailDomain } from './free-email-domains.js';

describe('isFreeEmailDomain', () => {
  it('flags major consumer webmail providers', () => {
    expect(isFreeEmailDomain('gmail.com')).toBe(true);
    expect(isFreeEmailDomain('outlook.com')).toBe(true);
    expect(isFreeEmailDomain('yahoo.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isFreeEmailDomain('Gmail.COM')).toBe(true);
  });

  it('does not flag an organizational domain', () => {
    expect(isFreeEmailDomain('cornell.edu')).toBe(false);
    expect(isFreeEmailDomain('some-veterinary-clinic.com')).toBe(false);
  });
});
