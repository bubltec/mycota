import { describe, expect, it, vi } from 'vitest';
import { FakeConnectOnboarding } from './fake.connect.js';
import { StripeConnectOnboarding, type StripeConnectClient } from './stripe.connect.js';

describe('FakeConnectOnboarding', () => {
  it('creates a pending Express account and completes KYC locally', async () => {
    const connect = new FakeConnectOnboarding();
    const account = await connect.createExpressAccount({ email: 'org@example.com' });
    expect(account.status).toBe('pending');
    expect(account.chargesEnabled).toBe(false);

    const link = await connect.createOnboardingLink({
      accountId: account.id,
      refreshUrl: 'https://app.local/refresh',
      returnUrl: 'https://app.local/return',
    });
    expect(link.url).toContain(account.id);

    const done = connect.complete(account.id);
    expect(done.status).toBe('complete');
    expect((await connect.getAccount(account.id)).payoutsEnabled).toBe(true);
  });
});

describe('StripeConnectOnboarding', () => {
  it('requests Express + card_payments/transfers and maps account status', async () => {
    const client: StripeConnectClient = {
      accounts: {
        create: vi.fn(async () => ({
          id: 'acct_1',
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          requirements: { currently_due: ['individual.id_number'] },
        })),
        retrieve: vi.fn(async () => ({
          id: 'acct_1',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          requirements: { currently_due: [] },
        })),
        createLoginLink: vi.fn(async () => ({ url: 'https://connect.stripe.com/express/login' })),
      },
      accountLinks: {
        create: vi.fn(async () => ({ url: 'https://connect.stripe.com/setup/e/acct_1' })),
      },
    };

    const connect = new StripeConnectOnboarding(client);
    const created = await connect.createExpressAccount({ email: 'org@example.com', country: 'US' });
    expect(created.status).toBe('restricted');
    expect(client.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'express',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      }),
    );

    const onboard = await connect.createOnboardingLink({
      accountId: 'acct_1',
      refreshUrl: 'https://app.local/refresh',
      returnUrl: 'https://app.local/return',
    });
    expect(onboard.url).toContain('connect.stripe.com');

    const retrieved = await connect.getAccount('acct_1');
    expect(retrieved.status).toBe('complete');
  });
});
