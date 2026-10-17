import type { Money } from './money.js';
import type {
  Address,
  CheckoutSession,
  CustomerDetails,
  CreateCheckoutInput,
  PaymentEvent,
  PaymentGateway,
  PaymentGatewayConfig,
  RefundInput,
  RefundResult,
  ShippingDetails,
} from './ports.js';

/**
 * Narrow Stripe surface so this package does not take a hard dependency on
 * the `stripe` SDK. The consuming app constructs the real client (or a test
 * double) and passes it in.
 */
export interface StripeCheckoutClient {
  checkout: {
    sessions: {
      /** The second argument is Stripe's request options: `{ stripeAccount }` makes the call on a connected account. */
      create: (params: Record<string, unknown>, options?: { stripeAccount: string }) => Promise<{ id: string; url: string | null }>;
    };
  };
  refunds: {
    create: (params: Record<string, unknown>, options?: { stripeAccount: string }) => Promise<{ id: string; status: string | null }>;
  };
  webhooks: {
    constructEvent: (body: string, signature: string, secret: string) => StripeWebhookEvent;
  };
}

export interface StripeWebhookEvent {
  type: string;
  /** Set on events that happened on a connected account. */
  account?: string;
  data: { object: Record<string, unknown> };
}

function toMajorUnit(amount: Money): number {
  return amount.amountCents;
}

/**
 * Stripe adapter. With a connected account the default is a destination charge (the platform is the merchant of record and the funds are
 * transferred to the account); `chargeMode: 'direct'` makes the charge on the connected account itself, which is then the merchant of
 * record and answers for refunds, disputes and tax, while the platform may still take an application fee. Swap this class for an
 * Adyen/Square adapter later without touching use cases.
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
    if (input.chargeMode === 'direct' && !input.connectedAccountId) {
      throw new Error("a direct charge needs the connected account it is made on");
    }
    if (input.shippingRates?.length && !input.shippingAddress) {
      throw new Error('shipping rates need shippingAddress: a buyer cannot pick a rate without giving an address');
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
          product_data: {
            name: line.name,
            ...(line.description ? { description: line.description } : {}),
            ...(line.imageUrl ? { images: [line.imageUrl] } : {}),
          },
        },
      })),
    };

    if (input.shippingAddress) {
      params.shipping_address_collection = { allowed_countries: input.shippingAddress.allowedCountries };
    }
    if (input.shippingRates?.length) {
      params.shipping_options = input.shippingRates.map((rate) => ({
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: rate.name,
          fixed_amount: { amount: rate.amount.amountCents, currency: rate.amount.currency },
        },
      }));
    }
    if (input.collectPhone) {
      params.phone_number_collection = { enabled: true };
    }

    const direct = input.chargeMode === 'direct' && input.connectedAccountId;
    if (input.connectedAccountId) {
      const paymentIntentData: Record<string, unknown> = { metadata: input.metadata };
      // A destination charge moves the funds to the account; a direct charge is made on the account, so there is nothing to move.
      if (!direct) paymentIntentData.transfer_data = { destination: input.connectedAccountId };
      if (input.applicationFee) {
        paymentIntentData.application_fee_amount = input.applicationFee.amountCents;
      }
      params.payment_intent_data = paymentIntentData;
    }

    const session = direct
      ? await this.stripe.checkout.sessions.create(params, { stripeAccount: input.connectedAccountId! })
      : await this.stripe.checkout.sessions.create(params);
    if (!session.url) {
      throw new Error('stripe checkout session missing url');
    }
    return { id: session.id, url: session.url };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const params: Record<string, unknown> = {
      payment_intent: input.paymentId,
      amount: input.amount?.amountCents,
      reason: input.reason,
      refund_application_fee: input.reverseApplicationFee ?? true,
    };
    // A direct charge lives on the seller's account: the refund is made there, and there is no transfer to reverse.
    if (!input.connectedAccountId) {
      params.reverse_transfer = input.reverseTransfer ?? Boolean(input.reverseApplicationFee ?? true);
    }
    const refund = input.connectedAccountId
      ? await this.stripe.refunds.create(params, { stripeAccount: input.connectedAccountId })
      : await this.stripe.refunds.create(params);
    const status =
      refund.status === 'succeeded' || refund.status === 'pending' || refund.status === 'failed'
        ? refund.status
        : 'pending';
    return { id: refund.id, status };
  }

  /** Stripe signs events on connected accounts with their own endpoint secret, so both are tried. */
  private verify(rawBody: string, signature: string): StripeWebhookEvent {
    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, this.config.webhookSecret);
    } catch (first) {
      if (!this.config.connectWebhookSecret) throw first;
      try {
        return this.stripe.webhooks.constructEvent(rawBody, signature, this.config.connectWebhookSecret);
      } catch {
        throw first;
      }
    }
  }

  async parseWebhook(rawBody: string, signature: string): Promise<PaymentEvent | null> {
    const event = this.verify(rawBody, signature);
    const object = event.data.object;
    const metadata = (object.metadata as Record<string, string> | undefined) ?? {};
    const currency = String(object.currency ?? this.config.currency ?? 'usd');
    const account = event.account ? { connectedAccountId: event.account } : {};

    if (event.type === 'checkout.session.completed') {
      const paymentId = String(object.payment_intent ?? object.id);
      const amountCents = Number(object.amount_total ?? 0);
      const customer = toCustomer(object.customer_details);
      const shipping = toShipping(object);
      return {
        type: 'checkout.completed',
        paymentId,
        amount: { amountCents, currency },
        metadata,
        ...account,
        ...(customer ? { customer } : {}),
        ...(shipping ? { shipping } : {}),
      };
    }
    if (event.type === 'checkout.session.expired' || event.type === 'payment_intent.payment_failed') {
      return {
        type: 'checkout.failed',
        paymentId: String(object.payment_intent ?? object.id),
        metadata,
        ...account,
      };
    }
    if (event.type === 'charge.refunded') {
      return {
        type: 'charge.refunded',
        paymentId: String(object.payment_intent ?? object.id),
        amount: { amountCents: Number(object.amount_refunded ?? 0), currency },
        ...account,
      };
    }
    return null;
  }
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

function toAddress(raw: unknown): Address {
  const a = (raw ?? {}) as Record<string, unknown>;
  const pairs: Array<[keyof Address, string | undefined]> = [
    ['line1', text(a.line1)],
    ['line2', text(a.line2)],
    ['city', text(a.city)],
    ['state', text(a.state)],
    ['postalCode', text(a.postal_code)],
    ['country', text(a.country)],
  ];
  return Object.fromEntries(pairs.filter(([, v]) => v !== undefined)) as Address;
}

function toCustomer(raw: unknown): CustomerDetails | undefined {
  const c = (raw ?? {}) as Record<string, unknown>;
  const out: CustomerDetails = { ...(text(c.email) ? { email: text(c.email)! } : {}), ...(text(c.name) ? { name: text(c.name)! } : {}), ...(text(c.phone) ? { phone: text(c.phone)! } : {}) };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Stripe moved shipping details under `collected_information` in newer API versions; read either. */
function toShipping(session: Record<string, unknown>): ShippingDetails | undefined {
  const collected = session.collected_information as { shipping_details?: unknown } | undefined;
  const raw = (collected?.shipping_details ?? session.shipping_details) as { name?: unknown; address?: unknown } | undefined;
  if (!raw?.address) return undefined;
  return { ...(text(raw.name) ? { name: text(raw.name)! } : {}), address: toAddress(raw.address) };
}
