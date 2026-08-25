import type { SendSmsResult, SmsMessage, SmsSender } from './ports.js';
import { toE164 } from './phone.js';

/**
 * Process-local SMS for tests and local boot. Messages stay in `sent`.
 */
export class FakeSmsSender implements SmsSender {
  readonly sent: Array<SmsMessage & { to: string }> = [];
  private seq = 0;

  async send(message: SmsMessage): Promise<SendSmsResult> {
    const to = toE164(message.to);
    if (!to.startsWith('+') || to.length < 8) throw new Error('sms to must be an E.164 phone number');
    if (!message.body) throw new Error('sms body is required');
    this.seq += 1;
    this.sent.push({ ...message, to });
    return { messageId: `fake_sms_${this.seq}` };
  }
}
