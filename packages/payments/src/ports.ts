import type { Money } from './money.js';

export interface CheckoutLine {
  name: string;
  quantity: number;
  unitAmount: Money;
  /** Shown under the name on the hosted checkout page. */
  description?: string;
  /** Absolute https URL of a picture shown beside the line. */
  imageUrl?: string;
}

/**
 * Who the seller of record is when `connectedAccountId` is set.
 *
 * - `destination` (the default, and what this package has always done): the charge is made on the platform and the funds are
 *   transferred to the connected account. The platform is the merchant of record: it answers for refunds, disputes and tax.
 * - `direct`: the charge is made on the connected account itself, which is the merchant of record. The platform is not in the
 *   money's path and may only take an `applicationFee`. Refunds must name the account (`RefundInput.connectedAccountId`).
 */
export type ChargeMode = 'destination' | 'direct';

/** A fixed-price way to ship, offered to the buyer. */
export interface ShippingRate {
  name: string;
  amount: Money;
}

export interface CreateCheckoutInput {
  /** Connected-account id when the platform is splitting funds (Stripe Connect, Adyen for Platforms). */
  connectedAccountId?: string;
  /** How funds move when `connectedAccountId` is set. Default `destination`. */
  chargeMode?: ChargeMode;
  /** Platform take, in the same currency as the lines. */
  applicationFee?: Money;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  lines: CheckoutLine[];
  metadata: Record<string, string>;
  /** Ask the buyer for a shipping address, limited to these ISO country codes. */
  shippingAddress?: { allowedCountries: string[] };
  /** Fixed shipping choices shown to the buyer. Needs `shippingAddress`. */
  shippingRates?: ShippingRate[];
  /** Ask the buyer for a phone number (for pickup, say). */
  collectPhone?: boolean;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export interface RefundInput {
  paymentId: string;
  /** The seller's account, for a payment made with `chargeMode: 'direct'`: the refund is made on that account. */
  connectedAccountId?: string;
  amount?: Money;
  reason?: string;
  /** Reverse the platform take. Default true — Eventbrite keeping the service fee is the behavior not to copy. */
  reverseApplicationFee?: boolean;
  /** Pull funds back from the connected account on a destination charge. */
  reverseTransfer?: boolean;
}

export interface RefundResult {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface CustomerDetails {
  email?: string;
  name?: string;
  phone?: string;
}

export interface ShippingDetails {
  name?: string;
  address: Address;
}

/**
 * What a webhook reports. `connectedAccountId` is set when the event happened on a connected account (a `direct` charge), which is how
 * the platform tells whose sale it was.
 */
export type PaymentEvent =
  | {
      type: 'checkout.completed';
      paymentId: string;
      amount: Money;
      metadata: Record<string, string>;
      connectedAccountId?: string;
      customer?: CustomerDetails;
      shipping?: ShippingDetails;
    }
  | {
      type: 'checkout.failed';
      paymentId: string;
      metadata: Record<string, string>;
      connectedAccountId?: string;
    }
  | {
      type: 'charge.refunded';
      paymentId: string;
      amount: Money;
      connectedAccountId?: string;
    };

/**
 * Outbound port for taking money, refunding it, and translating provider
 * webhooks into domain events. Inner layers depend on this, never on Stripe.
 */
export interface PaymentGateway {
  readonly provider: string;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  refund(input: RefundInput): Promise<RefundResult>;
  parseWebhook(rawBody: string, signature: string): Promise<PaymentEvent | null>;
}

export interface PaymentGatewayConfig {
  secretKey: string;
  webhookSecret: string;
  /**
   * Signing secret of the webhook endpoint that listens to events on connected accounts. Stripe signs those with a different secret from
   * the platform's own events, so a platform taking `direct` charges needs both. Optional: without it only `webhookSecret` is tried.
   */
  connectWebhookSecret?: string;
  /** Default currency when a Money value omits one. */
  currency?: string;
}
