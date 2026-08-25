/**
 * Normalize a phone number to E.164 for SNS. Bare 10-digit US numbers
 * become `+1…`. Already-prefixed values are left as digits-plus-plus only.
 */
export function toE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}
