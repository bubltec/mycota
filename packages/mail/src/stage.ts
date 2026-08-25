/**
 * Prod is unprefixed. Missing stage is treated as `dev` so a misconfigured
 * environment never looks like production.
 */
export function prefixNonProd(text: string, stage?: string): string {
  if (stage === 'prod') return text;
  return `[${stage ?? 'dev'}] ${text}`;
}
