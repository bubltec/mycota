import type { SendSmsResult, SmsMessage, SmsSender, SnsSmsClient } from './ports.js';
import { toE164 } from './phone.js';

export interface SnsSmsSenderOptions {
  /** When not `prod`, prefix bodies with `[stage] `. */
  stage?: string;
  senderId?: string;
}

function bodyFor(body: string, stage?: string): string {
  if (!stage || stage === 'prod') return body;
  return `[${stage}] ${body}`;
}

/**
 * SNS SMS adapter. The consuming app passes a narrow client so this package
 * never imports `@aws-sdk/client-sns`.
 */
export class SnsSmsSender implements SmsSender {
  constructor(
    private readonly client: SnsSmsClient,
    private readonly options: SnsSmsSenderOptions = {},
  ) {}

  async send(message: SmsMessage): Promise<SendSmsResult> {
    const phoneNumber = toE164(message.to);
    if (!phoneNumber.startsWith('+') || phoneNumber.length < 8) {
      throw new Error('sms to must be an E.164 phone number');
    }
    if (!message.body) throw new Error('sms body is required');

    const result = await this.client.publishSms({
      phoneNumber,
      message: bodyFor(message.body, this.options.stage),
      senderId: message.senderId ?? this.options.senderId,
    });
    if (!result.messageId) throw new Error('SNS did not return a message id');
    return { messageId: result.messageId };
  }
}
