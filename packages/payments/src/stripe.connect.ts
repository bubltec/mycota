import { connectStatus, type ConnectAccount, type ConnectOnboarding, type CreateExpressAccountInput, type CreateOnboardingLinkInput, type OnboardingLink } from './connect.js';

/**
 * Narrow Stripe Connect surface so this package does not take a `stripe`
 * SDK dependency. Same injection style as StripePaymentGateway.
 */
export interface StripeConnectClient {
  accounts: {
    create: (params: Record<string, unknown>) => Promise<StripeAccount>;
    retrieve: (id: string) => Promise<StripeAccount>;
    createLoginLink: (id: string) => Promise<{ url: string }>;
  };
  accountLinks: {
    create: (params: Record<string, unknown>) => Promise<{ url: string }>;
  };
}

export interface StripeAccount {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: { currently_due?: string[] };
}

function toAccount(raw: StripeAccount): ConnectAccount {
  const chargesEnabled = Boolean(raw.charges_enabled);
  const payoutsEnabled = Boolean(raw.payouts_enabled);
  const detailsSubmitted = Boolean(raw.details_submitted);
  const currentlyDue = raw.requirements?.currently_due?.length ?? 0;
  return {
    id: raw.id,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    status: connectStatus({ detailsSubmitted, chargesEnabled, currentlyDue }),
  };
}

export class StripeConnectOnboarding implements ConnectOnboarding {
  readonly provider = 'stripe';

  constructor(private readonly stripe: StripeConnectClient) {}

  async createExpressAccount(input: CreateExpressAccountInput): Promise<ConnectAccount> {
    const raw = await this.stripe.accounts.create({
      type: 'express',
      country: input.country ?? 'US',
      email: input.email,
      metadata: input.metadata,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    return toAccount(raw);
  }

  async createOnboardingLink(input: CreateOnboardingLinkInput): Promise<OnboardingLink> {
    const link = await this.stripe.accountLinks.create({
      account: input.accountId,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: 'account_onboarding',
    });
    return { url: link.url };
  }

  async createLoginLink(accountId: string): Promise<OnboardingLink> {
    const link = await this.stripe.accounts.createLoginLink(accountId);
    return { url: link.url };
  }

  async getAccount(accountId: string): Promise<ConnectAccount> {
    return toAccount(await this.stripe.accounts.retrieve(accountId));
  }
}
