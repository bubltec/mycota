import { describe, expect, it, vi } from 'vitest';
import { money } from './money.js';
import { StripePaymentGateway, type StripeCheckoutClient, type StripeWebhookEvent } from './stripe.adapter.js';

const line = { name: 'Tee', quantity: 2, unitAmount: money(2500) };
const base = { successUrl: 'https://shop.local/ok', cancelUrl: 'https://shop.local/no', metadata: { orderId: 'ord_1' }, lines: [line] };

function client(over: { event?: () => StripeWebhookEvent } = {}) {
  const create = vi.fn(async (_p: Record<string, unknown>, _o?: { stripeAccount: string }) => ({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' }));
  const refund = vi.fn(async (_p: Record<string, unknown>, _o?: { stripeAccount: string }) => ({ id: 're_1', status: 'succeeded' }));
  const constructEvent = vi.fn((_b: string, _s: string, _secret: string) => over.event?.() ?? { type: 'noop', data: { object: {} } });
  const stripe: StripeCheckoutClient = { checkout: { sessions: { create } }, refunds: { create: refund }, webhooks: { constructEvent } };
  return { stripe, create, refund, constructEvent };
}
const gateway = (c: ReturnType<typeof client>, extra: { connectWebhookSecret?: string } = {}) =>
  new StripePaymentGateway(c.stripe, { secretKey: 'sk', webhookSecret: 'whsec_platform', ...extra });

describe('direct charges: the connected account is the seller of record', () => {
  it('makes the checkout on the connected account, with no transfer, and may take a fee', async () => {
    const c = client();
    await gateway(c).createCheckout({ ...base, connectedAccountId: 'acct_shop', chargeMode: 'direct', applicationFee: money(100) });
    const [params, options] = c.create.mock.calls[0]!;
    expect(options).toEqual({ stripeAccount: 'acct_shop' });
    expect(params.payment_intent_data).toEqual({ metadata: { orderId: 'ord_1' }, application_fee_amount: 100 });
    expect(JSON.stringify(params)).not.toContain('transfer_data');
  });

  it('leaves the default exactly as it was: a destination charge, with no request options', async () => {
    const c = client();
    await gateway(c).createCheckout({ ...base, connectedAccountId: 'acct_shop', applicationFee: money(100) });
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(c.create.mock.calls[0]).toHaveLength(1); // called with the params alone
    expect(c.create.mock.calls[0]![0].payment_intent_data).toEqual({ transfer_data: { destination: 'acct_shop' }, application_fee_amount: 100, metadata: { orderId: 'ord_1' } });
    const explicit = client();
    await gateway(explicit).createCheckout({ ...base, connectedAccountId: 'acct_shop', chargeMode: 'destination' });
    expect(explicit.create.mock.calls[0]).toHaveLength(1);
  });

  it('refuses a direct charge that names no account, since there would be nowhere to make it', async () => {
    await expect(gateway(client()).createCheckout({ ...base, chargeMode: 'direct' })).rejects.toThrow(/connected account/);
  });

  it('refunds on the seller\'s account for a direct charge, with no transfer to reverse', async () => {
    const c = client();
    await gateway(c).refund({ paymentId: 'pi_1', connectedAccountId: 'acct_shop', amount: money(500) });
    const [params, options] = c.refund.mock.calls[0]!;
    expect(options).toEqual({ stripeAccount: 'acct_shop' });
    expect(params).toMatchObject({ payment_intent: 'pi_1', amount: 500, refund_application_fee: true });
    expect(params).not.toHaveProperty('reverse_transfer');
  });

  it('refunds a destination charge as before: on the platform, reversing the transfer', async () => {
    const c = client();
    await gateway(c).refund({ paymentId: 'pi_1' });
    expect(c.refund.mock.calls[0]).toHaveLength(1);
    expect(c.refund.mock.calls[0]![0]).toMatchObject({ refund_application_fee: true, reverse_transfer: true });
  });
});

describe('what the buyer is asked for', () => {
  it('can be asked for a shipping address and offered fixed shipping rates', async () => {
    const c = client();
    await gateway(c).createCheckout({
      ...base,
      shippingAddress: { allowedCountries: ['US', 'CA'] },
      shippingRates: [{ name: 'Standard', amount: money(500) }, { name: 'Express', amount: money(1500) }],
    });
    const params = c.create.mock.calls[0]![0];
    expect(params.shipping_address_collection).toEqual({ allowed_countries: ['US', 'CA'] });
    expect(params.shipping_options).toEqual([
      { shipping_rate_data: { type: 'fixed_amount', display_name: 'Standard', fixed_amount: { amount: 500, currency: 'usd' } } },
      { shipping_rate_data: { type: 'fixed_amount', display_name: 'Express', fixed_amount: { amount: 1500, currency: 'usd' } } },
    ]);
  });

  it('refuses shipping rates without an address to ship to', async () => {
    await expect(gateway(client()).createCheckout({ ...base, shippingRates: [{ name: 'Standard', amount: money(500) }] })).rejects.toThrow(/shippingAddress/);
  });

  it('can be asked for a phone number, and shows a description and picture for a line', async () => {
    const c = client();
    await gateway(c).createCheckout({ ...base, collectPhone: true, lines: [{ ...line, description: 'Soft cotton, black', imageUrl: 'https://cdn.test/tee.png' }, { name: 'Sticker', quantity: 1, unitAmount: money(300) }] });
    const params = c.create.mock.calls[0]![0] as { phone_number_collection: unknown; line_items: Array<{ price_data: { product_data: Record<string, unknown> } }> };
    expect(params.phone_number_collection).toEqual({ enabled: true });
    expect(params.line_items[0]!.price_data.product_data).toEqual({ name: 'Tee', description: 'Soft cotton, black', images: ['https://cdn.test/tee.png'] });
    expect(params.line_items[1]!.price_data.product_data).toEqual({ name: 'Sticker' }); // nothing extra when not given
  });

  it('asks for none of it unless told to', async () => {
    const c = client();
    await gateway(c).createCheckout(base);
    const params = c.create.mock.calls[0]![0];
    for (const key of ['shipping_address_collection', 'shipping_options', 'phone_number_collection', 'payment_intent_data']) expect(params).not.toHaveProperty(key);
  });
});

describe('webhooks from connected accounts', () => {
  const completed = (extra: Record<string, unknown> = {}, top: Record<string, unknown> = {}): StripeWebhookEvent => ({
    type: 'checkout.session.completed',
    ...top,
    data: { object: { id: 'cs_1', payment_intent: 'pi_1', amount_total: 5300, currency: 'usd', metadata: { orderId: 'ord_1' }, ...extra } },
  });

  it('reports which account the sale was on, who bought, and where to ship', async () => {
    const c = client({
      event: () =>
        completed(
          {
            customer_details: { email: 'buyer@example.com', name: 'Bea Buyer', phone: '+15551234567' },
            shipping_details: { name: 'Bea Buyer', address: { line1: '1 Main St', line2: null, city: 'Wilmington', state: 'DE', postal_code: '19806', country: 'US' } },
          },
          { account: 'acct_shop' },
        ),
    });
    expect(await gateway(c).parseWebhook('{}', 'sig')).toEqual({
      type: 'checkout.completed',
      paymentId: 'pi_1',
      amount: money(5300),
      metadata: { orderId: 'ord_1' },
      connectedAccountId: 'acct_shop',
      customer: { email: 'buyer@example.com', name: 'Bea Buyer', phone: '+15551234567' },
      shipping: { name: 'Bea Buyer', address: { line1: '1 Main St', city: 'Wilmington', state: 'DE', postalCode: '19806', country: 'US' } }, // empty line2 dropped
    });
  });

  it('reads shipping details where newer Stripe API versions put them', async () => {
    const c = client({ event: () => completed({ collected_information: { shipping_details: { name: 'Bea', address: { country: 'CA' } } } }) });
    expect(await gateway(c).parseWebhook('{}', 'sig')).toMatchObject({ shipping: { name: 'Bea', address: { country: 'CA' } } });
  });

  it('adds nothing for a sale with no shipping or customer details, and no account for a platform event', async () => {
    const c = client({ event: () => completed() });
    const event = await gateway(c).parseWebhook('{}', 'sig');
    expect(event).toEqual({ type: 'checkout.completed', paymentId: 'pi_1', amount: money(5300), metadata: { orderId: 'ord_1' } });
  });

  it('names the account on a failure and a refund too', async () => {
    const failed = client({ event: () => ({ type: 'checkout.session.expired', account: 'acct_shop', data: { object: { id: 'cs_1', metadata: { orderId: 'ord_1' } } } }) });
    expect(await gateway(failed).parseWebhook('{}', 'sig')).toEqual({ type: 'checkout.failed', paymentId: 'cs_1', metadata: { orderId: 'ord_1' }, connectedAccountId: 'acct_shop' });
    const refunded = client({ event: () => ({ type: 'charge.refunded', account: 'acct_shop', data: { object: { payment_intent: 'pi_1', amount_refunded: 500, currency: 'usd' } } }) });
    expect(await gateway(refunded).parseWebhook('{}', 'sig')).toEqual({ type: 'charge.refunded', paymentId: 'pi_1', amount: money(500), connectedAccountId: 'acct_shop' });
  });

  it('verifies events from connected accounts with their own secret when one is set, trying the platform\'s first', async () => {
    const c = client();
    c.constructEvent.mockImplementation((_b, _s, secret) => {
      if (secret !== 'whsec_connect') throw new Error('No signatures found matching the expected signature');
      return completed({}, { account: 'acct_shop' });
    });
    const event = await gateway(c, { connectWebhookSecret: 'whsec_connect' }).parseWebhook('{}', 'sig');
    expect(event).toMatchObject({ type: 'checkout.completed', connectedAccountId: 'acct_shop' });
    expect(c.constructEvent.mock.calls.map((call) => call[2])).toEqual(['whsec_platform', 'whsec_connect']);
  });

  it('still refuses a forged event, and reports the platform secret\'s failure, with or without a connect secret', async () => {
    for (const extra of [{}, { connectWebhookSecret: 'whsec_connect' }]) {
      const c = client();
      c.constructEvent.mockImplementation((_b, _s, secret) => {
        throw new Error(`bad signature for ${secret}`);
      });
      await expect(gateway(c, extra).parseWebhook('{}', 'forged')).rejects.toThrow('bad signature for whsec_platform');
    }
  });

  it('does not try the connect secret when the platform\'s accepts the event', async () => {
    const c = client({ event: () => completed() });
    await gateway(c, { connectWebhookSecret: 'whsec_connect' }).parseWebhook('{}', 'sig');
    expect(c.constructEvent).toHaveBeenCalledTimes(1);
  });
});
