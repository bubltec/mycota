import type { Money } from './money.js';
import type {
  CheckoutSession,
  CreateCheckoutInput,
  PaymentEvent,
  PaymentGateway,
  PaymentGatewayConfig,
  RefundInput,
  RefundResult,
} from './ports.js';

/**
 * Narrow Stripe surface so this package does not take a hard dependency on
 * the `stripe` SDK. The consuming app constructs the real client (or a test
 * double) and passes it in.
 */
export interface StripeCheckoutClient {
  checkout: {
    sessions: {
      create: (params: Record<string, unknown>) => Promise<{ id: string; url: string | null }>;
    };
  };
  refunds: {
    create: (params: Record<string, unknown>) => Promise<{ id: string; status: string | null }>;
  };
  webhooks: {
    constructEvent: (body: string, signature: string, secret: string) => StripeWebhookEvent;
  };
}

export interface StripeWebhookEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

function toMajorUnit(amount: Money): number {
  return amount.amountCents;
}

/**
 * Stripe adapter. Destination charges (platform is merchant of record, funds
 * land on the connected account) are the default Connect shape for ticketing
 * + merch marketplaces. Swap this class for an Adyen/Square adapter later
 * without touching use cases.
 */
export class StripePaymentGateway implements PaymentGateway {
  readonly provider = 'stripe';

  constructor(
    private readonly stripe: StripeCheckoutClient,
    private readonly config: PaymentGatewayConfig,
  ) {}

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    if (input.lines.length === 0) {
      throw new Error('checkout requires at least one line');
    }

    const params: Record<string, unknown> = {
      mode: 'payment',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail,
      metadata: input.metadata,
      line_items: input.lines.map((line) => ({
        quantity: line.quantity,
        price_data: {
          currency: line.unitAmount.currency,
          unit_amount: toMajorUnit(line.unitAmount),
          product_data: { name: line.name },
        },
      })),
    };

    if (input.connectedAccountId) {
      const paymentIntentData: Record<string, unknown> = {
        transfer_data: { destination: input.connectedAccountId },
        metadata: input.metadata,
      };
      if (input.applicationFee) {
        paymentIntentData.application_fee_amount = input.applicationFee.amountCents;
      }
      params.payment_intent_data = paymentIntentData;
    }

    const session = await this.stripe.checkout.sessions.create(params);
    if (!session.url) {
      throw new Error('stripe checkout session missing url');
    }
    return { id: session.id, url: session.url };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create({
      payment_intent: input.paymentId,
      amount: input.amount?.amountCents,
      reason: input.reason,
    });
    const status =
      refund.status === 'succeeded' || refund.status === 'pending' || refund.status === 'failed'
        ? refund.status
        : 'pending';
    return { id: refund.id, status };
  }

  async parseWebhook(rawBody: string, signature: string): Promise<PaymentEvent | null> {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.config.webhookSecret);
    const object = event.data.object;
    const metadata = (object.metadata as Record<string, string> | undefined) ?? {};
    const currency = String(object.currency ?? this.config.currency ?? 'usd');

    if (event.type === 'checkout.session.completed') {
      const paymentId = String(object.payment_intent ?? object.id);
      const amountCents = Number(object.amount_total ?? 0);
      return {
        type: 'checkout.completed',
        paymentId,
        amount: { amountCents, currency },
        metadata,
      };
    }
    if (event.type === 'checkout.session.expired' || event.type === 'payment_intent.payment_failed') {
      return {
        type: 'checkout.failed',
        paymentId: String(object.payment_intent ?? object.id),
        metadata,
      };
    }
    if (event.type === 'charge.refunded') {
      return {
        type: 'charge.refunded',
        paymentId: String(object.payment_intent ?? object.id),
        amount: { amountCents: Number(object.amount_refunded ?? 0), currency },
      };
    }
    return null;
  }
}
