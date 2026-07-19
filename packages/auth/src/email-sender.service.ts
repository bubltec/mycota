import { Inject, Injectable } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { MYCOTA_AUTH_CONFIG, type MycotaAuthConfig } from './auth.config.js';

@Injectable()
export class EmailSenderService {
  private readonly client: SESClient;

  constructor(@Inject(MYCOTA_AUTH_CONFIG) private readonly config: MycotaAuthConfig) {
    this.client = new SESClient({ region: config.awsRegion ?? 'us-east-1' });
  }

  async sendVerificationCode(toEmail: string, code: string): Promise<void> {
    const stagePrefix = this.config.stage === 'prod' ? '' : `[${this.config.stage ?? 'dev'}] `;
    await this.client.send(
      new SendEmailCommand({
        Source: this.config.emailFromAddress,
        Destination: { ToAddresses: [toEmail] },
        Message: {
          Subject: { Data: `${stagePrefix}Your verification code` },
          Body: {
            Text: {
              Data:
                `Your verification code is: ${code}\n\n` +
                "This code expires in 15 minutes. If you didn't request this, you can ignore this email.",
            },
          },
        },
      }),
    );
  }
}
