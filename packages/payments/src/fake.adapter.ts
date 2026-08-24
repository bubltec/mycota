import { addMoney, money, type Money } from './money.js';
import type {
  CheckoutSession,
  CreateCheckoutInput,
  PaymentEvent,
  PaymentGateway,
  RefundInput,
  RefundResult,
} from './ports.js';

export interface FakePaymentGatewayOptions {
  /** If set, `parseWebhook` treats this string as a valid signature. */
  webhookSecret?: string;
}

/**
 * In-memory gateway for local boot and tests. Checkout URLs are fake; the
 * consuming app can complete a payment by posting a signed webhook body.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly provider = 'fake';
  private readonly sessions = new Map<string, CreateCheckoutInput>();
  private seq = 0;

  constructor(private readonly options: FakePaymentGatewayOptions = {}) {}

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    if (input.lines.length === 0) {
      throw new Error('checkout requires at least one line');
    }
    this.seq += 1;
    const id = `cs_fake_${this.seq}`;
    this.sessions.set(id, input);
    return { id, url: `https://payments.local/checkout/${id}` };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return { id: `re_fake_${input.paymentId}`, status: 'succeeded' };
  }

  async parseWebhook(rawBody: string, signature: string): Promise<PaymentEvent | null> {
    const expected = this.options.webhookSecret;
    if (expected && signature !== expected) {
      throw new Error('invalid webhook signature');
    }
    const body = JSON.parse(rawBody) as {
      type?: string;
      paymentId?: string;
      amountCents?: number;
      currency?: string;
      metadata?: Record<string, string>;
    };
    const paymentId = body.paymentId ?? '';
    const metadata = body.metadata ?? {};
    const amount: Money = money(body.amountCents ?? 0, body.currency ?? 'usd');

    if (body.type === 'checkout.completed') {
      return { type: 'checkout.completed', paymentId, amount, metadata };
    }
    if (body.type === 'checkout.failed') {
      return { type: 'checkout.failed', paymentId, metadata };
    }
    if (body.type === 'charge.refunded') {
      return { type: 'charge.refunded', paymentId, amount };
    }
    return null;
  }

  checkoutTotal(id: string): Money | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    return session.lines.reduce(
      (sum, line) =>
        addMoney(sum, money(line.unitAmount.amountCents * line.quantity, line.unitAmount.currency)),
      money(0, session.lines[0]?.unitAmount.currency ?? 'usd'),
    );
  }
}
