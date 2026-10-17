import type {
  ConnectAccount,
  ConnectAccountStatus,
  ConnectOnboarding,
  CreateExpressAccountInput,
  CreateOnboardingLinkInput,
  OnboardingLink,
} from './connect.js';

/**
 * The slice of a Stripe v2 Accounts client this adapter calls (`new Stripe(key)` fits it), so this package takes no `stripe` SDK
 * dependency. Same injection style as `StripeConnectOnboarding`.
 */
export interface StripeConnectV2Client {
  v2: {
    core: {
      accounts: {
        create: (params: Record<string, unknown>) => Promise<StripeV2Account>;
        retrieve: (id: string, params?: Record<string, unknown>) => Promise<StripeV2Account>;
      };
      accountLinks: {
        create: (params: Record<string, unknown>) => Promise<{ url: string }>;
      };
    };
  };
}

type CapabilityStatus = 'active' | 'pending' | 'rejected' | 'restricted' | 'unsupported';

/** The parts of a v2 account this adapter reads. Everything is optional: a field Stripe does not return is "not yet". */
export interface StripeV2Account {
  id: string;
  configuration?: {
    merchant?: {
      capabilities?: {
        card_payments?: { status?: CapabilityStatus };
        stripe_balance?: { payouts?: { status?: CapabilityStatus } };
      };
    };
  };
  requirements?: {
    entries?: Array<{
      awaiting_action_from?: 'user' | 'stripe';
      minimum_deadline?: { status?: 'currently_due' | 'eventually_due' | 'past_due' };
      errors?: unknown[];
    }>;
  } | null;
}

export interface StripeConnectV2Options {
  /** Where a seller signs in to their own Stripe dashboard. Full-dashboard accounts have no login link to mint. Default `https://dashboard.stripe.com/login`. */
  dashboardUrl?: string;
}

/** What to ask for on every read, so the capability and requirement details come back. */
const INCLUDE = ['configuration.merchant', 'requirements'];

/**
 * What a v2 account says about itself, as the three things an app needs: can it take payments, can it be paid out, and has the person
 * done what Stripe asked of them.
 *
 *  - `chargesEnabled` / `payoutsEnabled`: the card-payments and payout capabilities are `active`.
 *  - `detailsSubmitted`: nothing is left for the person to do now (no requirement awaiting them is currently or past due).
 *  - `restricted`: Stripe rejected the card-payments capability, or something they sent was not accepted (a requirement awaiting them
 *    carries an error). Anything else not finished is `pending`, including Stripe still verifying what they sent, which needs nothing
 *    from them.
 */
export function toV2Account(raw: StripeV2Account): ConnectAccount {
  const merchant = raw.configuration?.merchant?.capabilities;
  const chargesEnabled = merchant?.card_payments?.status === 'active';
  const payoutsEnabled = merchant?.stripe_balance?.payouts?.status === 'active';
  const awaiting = (raw.requirements?.entries ?? []).filter((e) => e.awaiting_action_from === 'user');
  const due = awaiting.filter((e) => e.minimum_deadline?.status === 'currently_due' || e.minimum_deadline?.status === 'past_due');
  const detailsSubmitted = due.length === 0;
  const rejected = merchant?.card_payments?.status === 'rejected' || awaiting.some((e) => (e.errors?.length ?? 0) > 0);
  const status: ConnectAccountStatus = chargesEnabled && detailsSubmitted ? 'complete' : rejected ? 'restricted' : 'pending';
  return { id: raw.id, status, chargesEnabled, payoutsEnabled, detailsSubmitted };
}

/**
 * Stripe Connect onboarding on Accounts v2 with **Managed Risk**: Stripe collects fees from, and bears the losses of, the connected
 * account, the sellers keep the full Stripe Dashboard, and payments are direct charges. This is what a new platform that has not
 * accepted loss liability must use: Accounts v1 `type: 'express'` makes the platform the losses collector and Stripe refuses it.
 *
 * Because Stripe is the fees collector, a platform application fee is not available on these accounts.
 *
 * `createExpressAccount` keeps its name from `ConnectOnboarding`; the account it makes has the full dashboard, not Express.
 */
export class StripeConnectV2Onboarding implements ConnectOnboarding {
  readonly provider = 'stripe';
  private readonly dashboardUrl: string;

  constructor(
    private readonly stripe: StripeConnectV2Client,
    options: StripeConnectV2Options = {},
  ) {
    this.dashboardUrl = options.dashboardUrl ?? 'https://dashboard.stripe.com/login';
  }

  async createExpressAccount(input: CreateExpressAccountInput): Promise<ConnectAccount> {
    const raw = await this.stripe.v2.core.accounts.create({
      ...(input.email ? { contact_email: input.email } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      dashboard: 'full',
      identity: { country: (input.country ?? 'US').toLowerCase() },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
      include: INCLUDE,
    });
    return toV2Account(raw);
  }

  async createOnboardingLink(input: CreateOnboardingLinkInput): Promise<OnboardingLink> {
    const link = await this.stripe.v2.core.accountLinks.create({
      account: input.accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: { configurations: ['merchant'], refresh_url: input.refreshUrl, return_url: input.returnUrl },
      },
    });
    return { url: link.url };
  }

  /** A full-dashboard account signs in to Stripe itself: there is no one-time link to mint, so this is the sign-in page. */
  async createLoginLink(_accountId: string): Promise<OnboardingLink> {
    return { url: this.dashboardUrl };
  }

  async getAccount(accountId: string): Promise<ConnectAccount> {
    return toV2Account(await this.stripe.v2.core.accounts.retrieve(accountId, { include: INCLUDE }));
  }
}
