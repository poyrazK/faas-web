export function validateWebhookSearch(search: Record<string, unknown>): {
  direction?: 'inbound' | 'outbound';
} {
  return { direction: search.direction === 'inbound' ? 'inbound' : undefined };
}
