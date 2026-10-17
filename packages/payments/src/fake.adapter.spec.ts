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

  it('applies the same rules as the real adapter, so a misuse shows up in a test', async () => {
    const gateway = new FakePaymentGateway();
    const base = { successUrl: 'https://app.local/ok', cancelUrl: 'https://app.local/no', metadata: {}, lines: [{ name: 'Tee', quantity: 1, unitAmount: money(2500) }] };
    await expect(gateway.createCheckout({ ...base, chargeMode: 'direct' })).rejects.toThrow(/connected account/);
    await expect(gateway.createCheckout({ ...base, shippingRates: [{ name: 'Standard', amount: money(500) }] })).rejects.toThrow(/shippingAddress/);
    await expect(gateway.createCheckout({ ...base, chargeMode: 'direct', connectedAccountId: 'acct_1', shippingAddress: { allowedCountries: ['US'] } })).resolves.toMatchObject({ id: expect.stringMatching(/^cs_fake_/) });
  });

  it('lets a test see what a checkout and a refund asked for', async () => {
    const gateway = new FakePaymentGateway();
    const input = { successUrl: 'https://app.local/ok', cancelUrl: 'https://app.local/no', metadata: { orderId: 'o1' }, connectedAccountId: 'acct_1', chargeMode: 'direct' as const, collectPhone: true, lines: [{ name: 'Tee', quantity: 1, unitAmount: money(2500) }] };
    const session = await gateway.createCheckout(input);
    expect(gateway.checkoutInput(session.id)).toEqual(input);
    await gateway.refund({ paymentId: 'pi_1', connectedAccountId: 'acct_1' });
    expect(gateway.refundsRequested()).toEqual([{ paymentId: 'pi_1', connectedAccountId: 'acct_1' }]);
  });

  it('passes the account, buyer and shipping details of a completed sale through a webhook', async () => {
    const gateway = new FakePaymentGateway();
    const details = { connectedAccountId: 'acct_1', customer: { email: 'bea@example.com' }, shipping: { name: 'Bea', address: { country: 'US' } } };
    const event = await gateway.parseWebhook(JSON.stringify({ type: 'checkout.completed', paymentId: 'pi_1', amountCents: 2500, metadata: { orderId: 'o1' }, ...details }), '');
    expect(event).toEqual({ type: 'checkout.completed', paymentId: 'pi_1', amount: money(2500), metadata: { orderId: 'o1' }, ...details });
    expect(await gateway.parseWebhook(JSON.stringify({ type: 'checkout.completed', paymentId: 'pi_2', amountCents: 100 }), '')).toEqual({ type: 'checkout.completed', paymentId: 'pi_2', amount: money(100), metadata: {} });
  });
});

describe('FakePaymentGateway checkout lifetime', () => {
  it('holds the fake to the same limits as Stripe, so a misuse is caught in tests', async () => {
    const gw = new FakePaymentGateway();
    const base = { successUrl: 'https://x/ok', cancelUrl: 'https://x/no', metadata: {}, lines: [{ name: 'Tee', quantity: 1, unitAmount: money(100) }] };
    await expect(gw.createCheckout({ ...base, expiresInMinutes: 10 })).rejects.toThrow(/30 to 1440/);
    await expect(gw.createCheckout({ ...base, expiresInMinutes: 30 })).resolves.toMatchObject({ id: expect.any(String) });
  });
});
