import { describe, expect, it, vi } from 'vitest';
import { SendEmailCommand, type SESClient } from '@aws-sdk/client-ses';
import { SesMailer } from '@bubltec/mycota-mail';
import { sesClientFromSdk, sesMailerOptionsFromAuth } from './email-sender.service.js';

describe('sesMailerOptionsFromAuth', () => {
  it('passes from-address and stage through to SesMailer', async () => {
    const options = sesMailerOptionsFromAuth({
      emailFromAddress: 'noreply@example.com',
      stage: 'local',
    });
    expect(options).toEqual({ defaultFrom: 'noreply@example.com', stage: 'local' });

    const sendEmail = vi.fn(async (input: { from: string; subject: string }) => {
      expect(input.from).toBe('noreply@example.com');
      expect(input.subject).toBe('[local] Your verification code');
      return { messageId: 'ses_1' };
    });
    const mailer = new SesMailer({ sendEmail }, options);
    await mailer.send({ to: 'ada@example.com', subject: 'Your verification code', text: '123456' });
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it('leaves stage undefined so SesMailer prefixes [dev]', async () => {
    const options = sesMailerOptionsFromAuth({ emailFromAddress: 'noreply@example.com' });
    expect(options.stage).toBeUndefined();

    const sendEmail = vi.fn(async (input: { subject: string }) => {
      expect(input.subject).toBe('[dev] Your verification code');
      return { messageId: 'ses_2' };
    });
    await new SesMailer({ sendEmail }, options).send({
      to: 'ada@example.com',
      subject: 'Your verification code',
      text: '123456',
    });
  });
});

describe('sesClientFromSdk', () => {
  it('maps SesClient fields onto SendEmailCommand', async () => {
    let captured: SendEmailCommand | undefined;
    const sdk = {
      send: vi.fn(async (command: SendEmailCommand) => {
        captured = command;
        return { MessageId: 'mid_1' };
      }),
    } as unknown as Pick<SESClient, 'send'>;

    const result = await sesClientFromSdk(sdk).sendEmail({
      from: 'noreply@example.com',
      to: ['ada@example.com'],
      subject: '[dev] Your verification code',
      text: 'Your code is 123456',
      html: '<p>123456</p>',
      replyTo: ['reply@example.com'],
    });

    expect(result).toEqual({ messageId: 'mid_1' });
    expect(captured?.input).toEqual({
      Source: 'noreply@example.com',
      Destination: { ToAddresses: ['ada@example.com'] },
      ReplyToAddresses: ['reply@example.com'],
      Message: {
        Subject: { Data: '[dev] Your verification code', Charset: 'UTF-8' },
        Body: {
          Text: { Data: 'Your code is 123456', Charset: 'UTF-8' },
          Html: { Data: '<p>123456</p>', Charset: 'UTF-8' },
        },
      },
    });
  });

  it('throws when SES omits MessageId', async () => {
    const sdk = {
      send: vi.fn(async () => ({})),
    } as unknown as Pick<SESClient, 'send'>;
    await expect(
      sesClientFromSdk(sdk).sendEmail({
        from: 'noreply@example.com',
        to: ['ada@example.com'],
        subject: 'x',
        text: 'y',
      }),
    ).rejects.toThrow('SES did not return a message id');
  });
});
