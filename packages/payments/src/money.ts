export interface Money {
  amountCents: number;
  currency: string;
}

export function money(amountCents: number, currency = 'usd'): Money {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('amountCents must be a non-negative integer');
  }
  return { amountCents, currency: currency.toLowerCase() };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return money(a.amountCents + b.amountCents, a.currency);
}
