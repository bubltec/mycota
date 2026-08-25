import type { Mailer, MailMessage, SendMailResult } from './ports.js';

/**
 * Process-local mailer for tests and local boot. Messages stay in `sent`.
 */
export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  private seq = 0;

  async send(message: MailMessage): Promise<SendMailResult> {
    if (!message.to || (Array.isArray(message.to) && message.to.length === 0)) {
      throw new Error('mail to is required');
    }
    if (!message.subject) throw new Error('mail subject is required');
    if (!message.text) throw new Error('mail text is required');
    this.seq += 1;
    this.sent.push(message);
    return { messageId: `fake_mail_${this.seq}` };
  }
}
