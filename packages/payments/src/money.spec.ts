import { describe, expect, it } from 'vitest';
import { addMoney, money } from './money.js';

describe('money', () => {
  it('rejects fractional cents', () => {
    expect(() => money(1.5)).toThrow(/non-negative integer/);
  });

  it('adds same-currency amounts', () => {
    expect(addMoney(money(100, 'usd'), money(50, 'usd'))).toEqual(money(150, 'usd'));
  });

  it('refuses to mix currencies', () => {
    expect(() => addMoney(money(100, 'usd'), money(50, 'eur'))).toThrow(/currency mismatch/);
  });
});
