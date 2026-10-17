import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

/**
 * The account's internal event router: what is waiting, what was accepted,
 * where one event went, and what a publication would reach.
 *
 * Everything here reads `/v1/events/*` for the authenticated account; the
 * keys carry the account id so a workspace switch never shows another
 * account's backlog from cache. Reads are no-store on the server, so the
 * console keeps its own staleness short rather than pretending a snapshot is
 * still current.
 */

type S = components['schemas'];
export type EventBacklog = S['EventBacklogResponse'];
export type EventBacklogConsumer = S['EventBacklogConsumer'];
export type EventBacklogRecipient = S['EventBacklogRecipient'];
export type EventStorage = S['EventStorageUsageResponse'];
export type EventRetention = S['EventRetentionHealth'];
export type EventReceipt = S['EventReceiptResponse'];
export type EventReceiptRecipient = S['EventReceiptRecipientResponse'];
export type RecipientBlocker = S['EventRecipientBlockerResponse'];
export type RecipientBlockerQuery = S['EventRecipientBlockerQuery'];
export type RecipientBlockerItem = S['EventRecipientBlockerBatchItem'];
export type PreviewEventRequest = S['PreviewEventRequest'];
export type PreviewEventResult = S['PreviewEventResponse'];
export type PreviewSubscription = S['EventPreviewSubscription'];
export type PublishEventRequest = S['PublishEventRequest'];
export type PublishEventReceipt = S['PublishEventResponse'];
export type AppPublishEventRequest = S['AppPublishEventRequest'];
export type AppPublishEventResult = S['AppPublishEventResponse'];
export type AppPublishStatus = S['AppEventPublishStatusResponse'];

/** Recipient and consumer pages the overview reads; both are bounded by the API at 200. */
export const BACKLOG_PAGE = 100;
/** Recipients shown per receipt; the response says when more exist. */
export const RECEIPT_PAGE = 100;

export const eventsKey = (accountId: string) => ['account', accountId, 'events'] as const;
const backlogKey = (accountId: string, subscription?: string) =>
  [...eventsKey(accountId), 'backlog', subscription ?? ''] as const;

/** Waiting consumers and the oldest waiting recipients, optionally for one subscription. */
export function useEventBacklog(accountId: string, subscriptionId?: string) {
  return useQuery({
    queryKey: backlogKey(accountId, subscriptionId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/events/backlog', {
          params: {
            query: {
              limit: BACKLOG_PAGE,
              consumer_limit: BACKLOG_PAGE,
              ...(subscriptionId ? { subscription_id: subscriptionId } : {}),
            },
          },
          signal,
        })
      ),
    enabled: Boolean(accountId),
    retry: retryPolicy,
    staleTime: 10_000,
  });
}

export function useEventStorage(accountId: string) {
  return useQuery({
    queryKey: [...eventsKey(accountId), 'storage'],
    queryFn: ({ signal }) => unwrap(api.GET('/v1/events/storage', { signal })),
    enabled: Boolean(accountId),
    retry: retryPolicy,
    staleTime: 10_000,
  });
}

/** Retention health over the default 24h expiry lookahead; samples are not shown. */
export function useEventRetention(accountId: string) {
  return useQuery({
    queryKey: [...eventsKey(accountId), 'retention'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/events/retention', { params: { query: { limit: 1 } }, signal })),
    enabled: Boolean(accountId),
    retry: retryPolicy,
    staleTime: 30_000,
  });
}

export interface ReceiptLookup {
  source: string;
  id: string;
}

/** One retained receipt. A missing or foreign receipt is `not_found`. */
export function useEventReceipt(accountId: string, lookup: ReceiptLookup | null) {
  return useQuery({
    queryKey: [...eventsKey(accountId), 'receipt', lookup?.source ?? '', lookup?.id ?? ''],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/events/receipt', {
          params: { query: { source: lookup!.source, id: lookup!.id, limit: RECEIPT_PAGE } },
          signal,
        })
      ),
    enabled: Boolean(accountId && lookup),
    retry: retryPolicy,
    staleTime: 5_000,
  });
}

export interface ProducerKeyLookup {
  slug: string;
  key: string;
}

/** Producer-key reconciliation for an app; never publishes. */
export function useAppEventPublishStatus(accountId: string, lookup: ProducerKeyLookup | null) {
  return useQuery({
    queryKey: [...eventsKey(accountId), 'publish-status', lookup?.slug ?? '', lookup?.key ?? ''],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/events/publish-status', {
          params: {
            path: { slug: lookup!.slug },
            query: { key: lookup!.key, limit: RECEIPT_PAGE },
          },
          signal,
        })
      ),
    enabled: Boolean(accountId && lookup),
    retry: retryPolicy,
    staleTime: 5_000,
  });
}

/** Routing diagnostics for one exact waiting recipient. Read-only. */
export function useRecipientBlocker(accountId: string, query: RecipientBlockerQuery | null) {
  return useQuery({
    queryKey: [
      ...eventsKey(accountId),
      'blocker',
      query?.source ?? '',
      query?.id ?? '',
      query?.subscription_id ?? '',
      query?.expected_accepted_at ?? '',
    ],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/events/recipient-blocker', { params: { query: query! }, signal })),
    enabled: Boolean(accountId && query),
    retry: retryPolicy,
    staleTime: 5_000,
  });
}

/**
 * Diagnostics for several recipients of one receipt in a single read.
 *
 * POST only because the query list is a body; the server reads and never
 * writes, so this is a query, not a mutation. At most 50 queries per call.
 */
export function useRecipientBlockers(accountId: string, queries: RecipientBlockerQuery[]) {
  const bounded = queries.slice(0, 50);
  return useQuery({
    queryKey: [
      ...eventsKey(accountId),
      'blockers',
      bounded.map((q) => `${q.source}\u0000${q.id}\u0000${q.subscription_id}`).join('\u0001'),
    ],
    queryFn: ({ signal }) =>
      unwrap(api.POST('/v1/events/recipient-blockers', { body: { queries: bounded }, signal })),
    enabled: Boolean(accountId && bounded.length),
    retry: retryPolicy,
    staleTime: 5_000,
  });
}

/** Routing preview: evaluates subscriptions, persists nothing, enqueues nothing. */
export function usePreviewEvent() {
  return useMutation({
    mutationFn: (body: PreviewEventRequest) => unwrap(api.POST('/v1/events:preview', { body })),
  });
}

/** Publishes one account event. It fans out to every matching consumer. */
export function usePublishEvent(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PublishEventRequest) => unwrap(api.POST('/v1/events:publish', { body })),
    onSettled: () => qc.invalidateQueries({ queryKey: eventsKey(accountId) }),
  });
}

/** Publishes through an app's stable producer key; identical retries are duplicates. */
export function usePublishAppEvent(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: AppPublishEventRequest }) =>
      unwrap(api.POST('/v1/apps/{slug}/events:publish', { params: { path: { slug } }, body })),
    onSettled: () => qc.invalidateQueries({ queryKey: eventsKey(accountId) }),
  });
}
