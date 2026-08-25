export interface MailMessage {
  to: string | string[];
  from?: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface SendMailResult {
  messageId: string;
}

/**
 * Outbound transactional email. Inner layers never import SES — they send a
 * message and get a provider id.
 */
export interface Mailer {
  send(message: MailMessage): Promise<SendMailResult>;
}

/**
 * Narrow SES surface so `@bubltec/mycota-mail` does not take an AWS SDK
 * dependency. The consuming app constructs SES (or a test double).
 */
export interface SesClient {
  sendEmail(input: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html?: string;
    replyTo?: string[];
  }): Promise<{ messageId: string }>;
}
