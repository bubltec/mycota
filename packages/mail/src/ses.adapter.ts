import type { Mailer, MailMessage, SendMailResult, SesClient } from './ports.js';

export interface SesMailerOptions {
  defaultFrom: string;
  /** When not `prod`, prefix subjects with `[stage] `. */
  stage?: string;
}

function asList(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : [value]).map((row) => row.trim()).filter(Boolean);
}

function subjectFor(subject: string, stage?: string): string {
  if (!stage || stage === 'prod') return subject;
  return `[${stage}] ${subject}`;
}

/**
 * SES adapter. The consuming app passes a narrow client so this package
 * never imports `@aws-sdk/client-ses`.
 */
export class SesMailer implements Mailer {
  constructor(
    private readonly client: SesClient,
    private readonly options: SesMailerOptions,
  ) {}

  async send(message: MailMessage): Promise<SendMailResult> {
    const to = asList(message.to);
    if (to.length === 0) throw new Error('mail to is required');
    const from = message.from?.trim() || this.options.defaultFrom;
    if (!from) throw new Error('mail from is required');
    if (!message.subject) throw new Error('mail subject is required');
    if (!message.text) throw new Error('mail text is required');

    const result = await this.client.sendEmail({
      from,
      to,
      subject: subjectFor(message.subject, this.options.stage),
      text: message.text,
      html: message.html,
      replyTo: message.replyTo ? [message.replyTo] : undefined,
    });
    if (!result.messageId) throw new Error('SES did not return a message id');
    return { messageId: result.messageId };
  }
}
