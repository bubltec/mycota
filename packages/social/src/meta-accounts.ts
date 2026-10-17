import { createDefaultFetch } from './http.js';
import type { FetchLike } from './ports.js';

export interface MetaDestination {
  platform: 'instagram' | 'facebook';
  accountId: string;
  displayName: string;
  /** Facebook Page that owns this destination. Same as accountId for Pages. */
  pageId: string;
}

interface GraphPage {
  id: string;
  name?: string;
  instagram_business_account?: { id: string; username?: string; name?: string };
}

/**
 * Destinations available after Facebook Login for Business. Not used for
 * Instagram Login or Threads — those tokens live on other hosts.
 */
export async function listMetaDestinations(input: {
  accessToken: string;
  fetch?: FetchLike;
  graphBaseUrl?: string;
}): Promise<MetaDestination[]> {
  const fetchFn = input.fetch ?? createDefaultFetch();
  const base = input.graphBaseUrl ?? 'https://graph.facebook.com/v22.0';
  const params = new URLSearchParams({
    fields: 'id,name,instagram_business_account{id,username,name}',
    access_token: input.accessToken,
  });
  const response = await fetchFn(`${base}/me/accounts?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`graph /me/accounts ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { data?: GraphPage[] };
  const destinations: MetaDestination[] = [];
  for (const page of body.data ?? []) {
    destinations.push({
      platform: 'facebook',
      accountId: page.id,
      displayName: page.name ?? page.id,
      pageId: page.id,
    });
    const ig = page.instagram_business_account;
    if (ig?.id) {
      destinations.push({
        platform: 'instagram',
        accountId: ig.id,
        displayName: ig.username ? `@${ig.username}` : (ig.name ?? ig.id),
        pageId: page.id,
      });
    }
  }
  return destinations;
}
