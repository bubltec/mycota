import { describe, expect, it, vi } from 'vitest';
import { money } from './money.js';
import { StripePaymentGateway, type StripeCheckoutClient } from './stripe.adapter.js';

function stubClient(overrides: Partial<StripeCheckoutClient> = {}): StripeCheckoutClient {
  return {
    checkout: {
      sessions: {
        create: vi.fn(async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })),
      },
    },
    refunds: {
      create: vi.fn(async () => ({ id: 're_test_1', status: 'succeeded' })),
    },
    webhooks: {
      constructEvent: vi.fn(() => ({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_1',
            payment_intent: 'pi_test_1',
            amount_total: 3000,
            currency: 'usd',
            metadata: { orderId: 'ord_1' },
          },
        },
      })),
    },
    ...overrides,
  };
}

describe('StripePaymentGateway', () => {
  it('maps lines onto Stripe Checkout and destination-charges Connect accounts', async () => {
    const client = stubClient();
    const gateway = new StripePaymentGateway(client, {
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
    });

    const session = await gateway.createCheckout({
      connectedAccountId: 'acct_org',
      applicationFee: money(150),
      successUrl: 'https://app.local/ok',
      cancelUrl: 'https://app.local/no',
      metadata: { orderId: 'ord_1' },
      lines: [{ name: 'GA', quantity: 1, unitAmount: money(3000) }],
    });

    expect(session).toEqual({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });
    expect(client.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        payment_intent_data: {
          transfer_data: { destination: 'acct_org' },
          application_fee_amount: 150,
          metadata: { orderId: 'ord_1' },
        },
      }),
    );
  });

  it('translates checkout.session.completed into a domain event', async () => {
    const client = stubClient();
    const gateway = new StripePaymentGateway(client, {
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
    });
    const event = await gateway.parseWebhook('{}', 'sig');
    expect(event).toEqual({
      type: 'checkout.completed',
      paymentId: 'pi_test_1',
      amount: money(3000),
      metadata: { orderId: 'ord_1' },
    });
  });
});
