import { Inject, Injectable } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SesMailer, type Mailer, type SesClient, type SesMailerOptions } from '@bubltec/mycota-mail';
import { MYCOTA_AUTH_CONFIG, type MycotaAuthConfig } from './auth.config.js';

export function sesMailerOptionsFromAuth(
  config: Pick<MycotaAuthConfig, 'emailFromAddress' | 'stage'>,
): SesMailerOptions {
  return { defaultFrom: config.emailFromAddress, stage: config.stage };
}

export function sesClientFromSdk(client: Pick<SESClient, 'send'>): SesClient {
  return {
    async sendEmail(input) {
      const result = await client.send(
        new SendEmailCommand({
          Source: input.from,
          Destination: { ToAddresses: input.to },
          ReplyToAddresses: input.replyTo,
          Message: {
            Subject: { Data: input.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: input.text, Charset: 'UTF-8' },
              Html: input.html ? { Data: input.html, Charset: 'UTF-8' } : undefined,
            },
          },
        }),
      );
      if (!result.MessageId) throw new Error('SES did not return a message id');
      return { messageId: result.MessageId };
    },
  };
}

@Injectable()
export class EmailSenderService {
  private readonly mailer: Mailer;

  constructor(@Inject(MYCOTA_AUTH_CONFIG) config: MycotaAuthConfig) {
    const client = new SESClient({ region: config.awsRegion ?? 'us-east-1' });
    this.mailer = new SesMailer(sesClientFromSdk(client), sesMailerOptionsFromAuth(config));
  }

  async sendVerificationCode(toEmail: string, code: string): Promise<void> {
    await this.mailer.send({
      to: toEmail,
      subject: 'Your verification code',
      text:
        `Your verification code is: ${code}\n\n` +
        "This code expires in 15 minutes. If you didn't request this, you can ignore this email.",
    });
  }
}
