import { describe, expect, it, vi } from 'vitest';
import { FakeMailer } from './fake.adapter.js';
import { SesMailer, type SesClient } from './index.js';

describe('FakeMailer', () => {
  it('records sent messages', async () => {
    const mailer = new FakeMailer();
    const result = await mailer.send({
      to: 'ada@example.com',
      subject: 'Invite',
      text: 'Accept: https://example.com/invite/x',
    });
    expect(result.messageId).toBe('fake_mail_1');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe('ada@example.com');
  });
});

describe('SesMailer', () => {
  it('sends through the injected client and prefixes non-prod subjects', async () => {
    const client: SesClient = {
      sendEmail: vi.fn(async (input) => {
        expect(input.from).toBe('noreply@example.com');
        expect(input.to).toEqual(['ada@example.com']);
        expect(input.subject).toBe('[local] Invite');
        expect(input.text).toContain('Accept');
        return { messageId: 'ses_1' };
      }),
    };
    const mailer = new SesMailer(client, { defaultFrom: 'noreply@example.com', stage: 'local' });
    const result = await mailer.send({
      to: 'ada@example.com',
      subject: 'Invite',
      text: 'Accept: https://example.com/invite/x',
      html: '<p>Accept</p>',
    });
    expect(result.messageId).toBe('ses_1');
  });

  it('does not prefix subjects in prod', async () => {
    const client: SesClient = {
      sendEmail: vi.fn(async (input) => {
        expect(input.subject).toBe('Invite');
        return { messageId: 'ses_2' };
      }),
    };
    const mailer = new SesMailer(client, { defaultFrom: 'noreply@example.com', stage: 'prod' });
    await mailer.send({ to: 'ada@example.com', subject: 'Invite', text: 'hi' });
  });
});
