export const STATUSES = ['draft', 'published'] as const;
export type Status = (typeof STATUSES)[number];

/** Rows written before status existed are treated as published. */
export function statusOf(item: { status?: Status; [key: string]: any }): Status {
  return item.status ?? 'published';
}
