import type {
  ConnectAccount,
  ConnectOnboarding,
  CreateExpressAccountInput,
  CreateOnboardingLinkInput,
  OnboardingLink,
} from './connect.js';

/**
 * In-memory Express accounts for local boot. Onboarding links are fake URLs;
 * `complete(accountId)` stands in for the organizer finishing KYC.
 */
export class FakeConnectOnboarding implements ConnectOnboarding {
  readonly provider = 'fake';
  private readonly accounts = new Map<string, ConnectAccount>();
  private seq = 0;

  async createExpressAccount(_input: CreateExpressAccountInput): Promise<ConnectAccount> {
    this.seq += 1;
    const account: ConnectAccount = {
      id: `acct_fake_${this.seq}`,
      status: 'pending',
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    };
    this.accounts.set(account.id, account);
    return account;
  }

  async createOnboardingLink(input: CreateOnboardingLinkInput): Promise<OnboardingLink> {
    this.require(input.accountId);
    return { url: `https://connect.local/onboard/${input.accountId}` };
  }

  async createLoginLink(accountId: string): Promise<OnboardingLink> {
    this.require(accountId);
    return { url: `https://connect.local/login/${accountId}` };
  }

  async getAccount(accountId: string): Promise<ConnectAccount> {
    return this.require(accountId);
  }

  /** Test/local helper — the hosted KYC page does this in production. */
  complete(accountId: string): ConnectAccount {
    const account = this.require(accountId);
    const next: ConnectAccount = {
      ...account,
      status: 'complete',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    };
    this.accounts.set(accountId, next);
    return next;
  }

  private require(accountId: string): ConnectAccount {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error(`connect account ${accountId} not found`);
    return account;
  }
}
