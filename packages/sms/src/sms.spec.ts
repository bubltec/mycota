import { describe, expect, it, vi } from 'vitest';
import { FakeSmsSender } from './fake.adapter.js';
import { toE164 } from './phone.js';
import { SnsSmsSender, type SnsSmsClient } from './index.js';

describe('toE164', () => {
  it('normalizes US numbers', () => {
    expect(toE164('555-123-4567')).toBe('+15551234567');
    expect(toE164('15551234567')).toBe('+15551234567');
    expect(toE164('+15551234567')).toBe('+15551234567');
  });
});

describe('FakeSmsSender', () => {
  it('records normalized destinations', async () => {
    const sms = new FakeSmsSender();
    const result = await sms.send({ to: '5551234567', body: 'Accept: https://example.com' });
    expect(result.messageId).toBe('fake_sms_1');
    expect(sms.sent[0]?.to).toBe('+15551234567');
  });
});

describe('SnsSmsSender', () => {
  it('publishes E.164 through the injected client', async () => {
    const client: SnsSmsClient = {
      publishSms: vi.fn(async (input) => {
        expect(input.phoneNumber).toBe('+15551234567');
        expect(input.message).toBe('[local] Accept now');
        expect(input.senderId).toBe('Sloth');
        return { messageId: 'sns_1' };
      }),
    };
    const sender = new SnsSmsSender(client, { stage: 'local', senderId: 'Sloth' });
    const result = await sender.send({ to: '555-123-4567', body: 'Accept now' });
    expect(result.messageId).toBe('sns_1');
  });
});
