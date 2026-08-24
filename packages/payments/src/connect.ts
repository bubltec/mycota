export type ConnectAccountStatus = 'pending' | 'complete' | 'restricted';

export interface ConnectAccount {
  id: string;
  status: ConnectAccountStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

export interface CreateExpressAccountInput {
  email?: string;
  country?: string;
  metadata?: Record<string, string>;
}

export interface CreateOnboardingLinkInput {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}

export interface OnboardingLink {
  url: string;
}

/**
 * Stripe Connect Express (or an equivalent facilitator) onboarding. Inner
 * layers ask for an account and a hosted KYC URL — they never import Stripe.
 */
export interface ConnectOnboarding {
  readonly provider: string;
  createExpressAccount(input: CreateExpressAccountInput): Promise<ConnectAccount>;
  createOnboardingLink(input: CreateOnboardingLinkInput): Promise<OnboardingLink>;
  createLoginLink(accountId: string): Promise<OnboardingLink>;
  getAccount(accountId: string): Promise<ConnectAccount>;
}

export function connectStatus(input: {
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  currentlyDue: number;
}): ConnectAccountStatus {
  if (input.currentlyDue > 0) return 'restricted';
  if (input.detailsSubmitted && input.chargesEnabled) return 'complete';
  return 'pending';
}
