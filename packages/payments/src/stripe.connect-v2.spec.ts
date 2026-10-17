import { describe, expect, it, vi } from 'vitest';
import { StripeConnectV2Onboarding, toV2Account, type StripeConnectV2Client, type StripeV2Account } from './stripe.connect-v2.js';

const entry = (status: 'currently_due' | 'eventually_due' | 'past_due', by: 'user' | 'stripe' = 'user', errors: unknown[] = []) => ({
  awaiting_action_from: by,
  minimum_deadline: { status },
  errors,
});
const account = (over: Partial<StripeV2Account> & { card?: string; payouts?: string } = {}): StripeV2Account => {
  const { card, payouts, ...rest } = over;
  return {
    id: 'acct_v2',
    configuration: { merchant: { capabilities: { card_payments: { status: (card ?? 'restricted') as never }, stripe_balance: { payouts: { status: (payouts ?? 'restricted') as never } } } } },
    requirements: { entries: [entry('currently_due')] },
    ...rest,
  };
};

describe('toV2Account', () => {
  it('is pending, with nothing submitted, while the person still has things to do', () => {
    expect(toV2Account(account())).toEqual({ id: 'acct_v2', status: 'pending', chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
  });

  it('is complete once card payments are active and nothing is left for the person', () => {
    expect(toV2Account(account({ card: 'active', payouts: 'active', requirements: { entries: [] } }))).toEqual({ id: 'acct_v2', status: 'complete', chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
    expect(toV2Account(account({ card: 'active', requirements: null })).status).toBe('complete');
  });

  it('is pending, and submitted, while Stripe is still verifying what the person sent', () => {
    const a = toV2Account(account({ card: 'pending', requirements: { entries: [entry('currently_due', 'stripe')] } }));
    expect(a).toMatchObject({ status: 'pending', detailsSubmitted: true, chargesEnabled: false });
  });

  it('ignores requirements that are only eventually due, and ones Stripe owns', () => {
    const a = toV2Account(account({ card: 'active', requirements: { entries: [entry('eventually_due'), entry('past_due', 'stripe')] } }));
    expect(a).toMatchObject({ status: 'complete', detailsSubmitted: true });
  });

  it('is restricted when something the person sent was not accepted', () => {
    const a = toV2Account(account({ requirements: { entries: [entry('past_due', 'user', [{ code: 'verification_failed_other' }])] } }));
    expect(a).toMatchObject({ status: 'restricted', detailsSubmitted: false });
  });

  it('is restricted when Stripe has rejected the card-payments capability', () => {
    expect(toV2Account(account({ card: 'rejected', requirements: { entries: [] } }))).toMatchObject({ status: 'restricted', chargesEnabled: false });
  });

  it('is not complete if payments are active but something has become due again', () => {
    expect(toV2Account(account({ card: 'active', requirements: { entries: [entry('past_due')] } }))).toMatchObject({ status: 'pending', chargesEnabled: true, detailsSubmitted: false });
  });

  it('treats a response with nothing in it as unable to take payments rather than crashing', () => {
    expect(toV2Account({ id: 'acct_x' })).toEqual({ id: 'acct_x', status: 'pending', chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true });
  });
});

describe('StripeConnectV2Onboarding', () => {
  const client = () => {
    const c = {
      v2: {
        core: {
          accounts: {
            create: vi.fn(async (_params: Record<string, unknown>) => account()),
            retrieve: vi.fn(async (_id: string, _params?: Record<string, unknown>) => account({ card: 'active', payouts: 'active', requirements: { entries: [] } })),
          },
          accountLinks: { create: vi.fn(async (_params: Record<string, unknown>) => ({ url: 'https://connect.stripe.com/setup/acct_v2' })) },
        },
      },
    } satisfies StripeConnectV2Client;
    return c;
  };

  it('creates a full-dashboard account where Stripe collects the fees and bears the losses, with no legacy type', async () => {
    const stripe = client();
    const created = await new StripeConnectV2Onboarding(stripe).createExpressAccount({ email: 'seller@example.com', country: 'US', metadata: { ownerId: 'u1' } });
    expect(created).toMatchObject({ id: 'acct_v2', status: 'pending' });
    const params = stripe.v2.core.accounts.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params).toMatchObject({
      contact_email: 'seller@example.com',
      metadata: { ownerId: 'u1' },
      dashboard: 'full',
      identity: { country: 'us' },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
    });
    expect(params).not.toHaveProperty('type');
    expect(params.include).toEqual(expect.arrayContaining(['configuration.merchant', 'requirements']));
  });

  it('defaults to the US and leaves out an email and metadata it was not given', async () => {
    const stripe = client();
    await new StripeConnectV2Onboarding(stripe).createExpressAccount({});
    const params = stripe.v2.core.accounts.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params).toMatchObject({ identity: { country: 'us' } });
    expect(params).not.toHaveProperty('contact_email');
    expect(params).not.toHaveProperty('metadata');
  });

  it('links to Stripe\'s hosted onboarding for the merchant configuration, returning to the given pages', async () => {
    const stripe = client();
    const link = await new StripeConnectV2Onboarding(stripe).createOnboardingLink({ accountId: 'acct_v2', refreshUrl: 'https://app.test/refresh', returnUrl: 'https://app.test/return' });
    expect(link.url).toContain('connect.stripe.com');
    expect(stripe.v2.core.accountLinks.create).toHaveBeenCalledWith({
      account: 'acct_v2',
      use_case: { type: 'account_onboarding', account_onboarding: { configurations: ['merchant'], refresh_url: 'https://app.test/refresh', return_url: 'https://app.test/return' } },
    });
  });

  it('reads an account back with its capabilities and requirements', async () => {
    const stripe = client();
    expect(await new StripeConnectV2Onboarding(stripe).getAccount('acct_v2')).toEqual({ id: 'acct_v2', status: 'complete', chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
    expect(stripe.v2.core.accounts.retrieve).toHaveBeenCalledWith('acct_v2', { include: expect.arrayContaining(['configuration.merchant', 'requirements']) });
  });

  it('points a seller at Stripe\'s own sign-in, because a full dashboard has no one-time login link', async () => {
    const stripe = client();
    expect((await new StripeConnectV2Onboarding(stripe).createLoginLink('acct_v2')).url).toBe('https://dashboard.stripe.com/login');
    expect((await new StripeConnectV2Onboarding(stripe, { dashboardUrl: 'https://dashboard.test/' }).createLoginLink('acct_v2')).url).toBe('https://dashboard.test/');
  });
});
