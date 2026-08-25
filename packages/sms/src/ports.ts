export interface SmsMessage {
  to: string;
  body: string;
  /** Optional sender ID — supported in some SNS regions only. */
  senderId?: string;
}

export interface SendSmsResult {
  messageId: string;
}

/**
 * Outbound transactional SMS. Inner layers never import SNS — they send a
 * message and get a provider id.
 */
export interface SmsSender {
  send(message: SmsMessage): Promise<SendSmsResult>;
}

/**
 * Narrow SNS SMS surface so `@bubltec/mycota-sms` does not take an AWS SDK
 * dependency. The consuming app constructs SNS (or a test double).
 */
export interface SnsSmsClient {
  publishSms(input: {
    phoneNumber: string;
    message: string;
    senderId?: string;
  }): Promise<{ messageId: string }>;
}
