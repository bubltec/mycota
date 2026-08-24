import type { Money } from './money.js';

export interface CheckoutLine {
  name: string;
  quantity: number;
  unitAmount: Money;
}

export interface CreateCheckoutInput {
  /** Connected-account id when the platform is splitting funds (Stripe Connect, Adyen for Platforms). */
  connectedAccountId?: string;
  /** Platform take, in the same currency as the lines. */
  applicationFee?: Money;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  lines: CheckoutLine[];
  metadata: Record<string, string>;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export interface RefundInput {
  paymentId: string;
  amount?: Money;
  reason?: string;
}

export interface RefundResult {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
}

export type PaymentEvent =
  | {
      type: 'checkout.completed';
      paymentId: string;
      amount: Money;
      metadata: Record<string, string>;
    }
  | {
      type: 'checkout.failed';
      paymentId: string;
      metadata: Record<string, string>;
    }
  | {
      type: 'charge.refunded';
      paymentId: string;
      amount: Money;
    };

/**
 * Outbound port for taking money, refunding it, and translating provider
 * webhooks into domain events. Inner layers depend on this, never on Stripe.
 */
export interface PaymentGateway {
  readonly provider: string;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  refund(input: RefundInput): Promise<RefundResult>;
  parseWebhook(rawBody: string, signature: string): Promise<PaymentEvent | null>;
}

export interface PaymentGatewayConfig {
  secretKey: string;
  webhookSecret: string;
  /** Default currency when a Money value omits one. */
  currency?: string;
}
