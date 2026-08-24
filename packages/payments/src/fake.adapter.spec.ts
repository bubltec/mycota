import { describe, expect, it } from 'vitest';
import { FakePaymentGateway } from './fake.adapter.js';
import { money } from './money.js';

describe('FakePaymentGateway', () => {
  it('creates a checkout and totals the lines', async () => {
    const gateway = new FakePaymentGateway();
    const session = await gateway.createCheckout({
      successUrl: 'https://app.local/ok',
      cancelUrl: 'https://app.local/no',
      metadata: { orderId: 'ord_1' },
      lines: [
        { name: 'GA', quantity: 2, unitAmount: money(3000) },
        { name: 'Tee', quantity: 1, unitAmount: money(2500) },
      ],
    });
    expect(session.id).toMatch(/^cs_fake_/);
    expect(gateway.checkoutTotal(session.id)).toEqual(money(8500));
  });

  it('rejects unsigned webhooks when a secret is configured', async () => {
    const gateway = new FakePaymentGateway({ webhookSecret: 'whsec_test' });
    await expect(
      gateway.parseWebhook(JSON.stringify({ type: 'checkout.completed' }), 'nope'),
    ).rejects.toThrow(/invalid webhook signature/);
  });

  it('parses a completed checkout webhook', async () => {
    const gateway = new FakePaymentGateway({ webhookSecret: 'whsec_test' });
    const event = await gateway.parseWebhook(
      JSON.stringify({
        type: 'checkout.completed',
        paymentId: 'pi_1',
        amountCents: 8500,
        metadata: { orderId: 'ord_1' },
      }),
      'whsec_test',
    );
    expect(event).toEqual({
      type: 'checkout.completed',
      paymentId: 'pi_1',
      amount: money(8500),
      metadata: { orderId: 'ord_1' },
    });
  });
});
