import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';

export type BillingIdentityPatch = components['schemas']['UpdateAccountBillingInfoRequest'];
export type BillingStatus = components['schemas']['BillingStatusResponse'];
export type InvoiceHistoryPage = components['schemas']['InvoiceHistoryBackfillResponse'];

/**
 * apid's byte caps on the billing identity (faas
 * pkg/apid/apidserver/handlers_billing_identity.go:15). It measures the
 * trimmed value in UTF-8 bytes, not characters.
 */
export const BILLING_IDENTITY_MAX_BYTES = {
  business_name: 256,
  billing_address: 1000,
  tax_id: 128,
} as const;

export type BillingIdentityField = keyof typeof BILLING_IDENTITY_MAX_BYTES;

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * The account, read under the same key the session uses, so a saved identity
 * lands in one cache entry. The identity fields ride on `GET /v1/account`;
 * there is no separate read.
 */
export function useAccountRecord() {
  return useQuery({
    queryKey: keys.account,
    queryFn: ({ signal }) => unwrap(api.GET('/v1/account', { signal })),
    staleTime: 30_000,
    retry: retryPolicy,
  });
}

/**
 * `PATCH /v1/account/billing`: omitted fields are kept, an empty string clears
 * one. The caller owns the idempotency key so a retry after the MFA step-up
 * replays the same logical write instead of auditing a second one.
 */
export function useUpdateBillingIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key }: { body: BillingIdentityPatch; key: string }) =>
      unwrap(
        api.PATCH('/v1/account/billing', {
          headers: { 'Idempotency-Key': key },
          body,
        })
      ),
    onSuccess: (next) => {
      // The response is the whole account: take it as the read-back.
      qc.setQueryData(keys.account, next);
    },
  });
}

/** Provider-independent billing status: mode, provider and attachment flags. */
export function useBillingStatus(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...keys.account, 'billing-status'],
    queryFn: () => unwrap(api.GET('/v1/billing/status', {})),
    enabled: options.enabled ?? true,
    retry: retryPolicy,
    staleTime: 60_000,
  });
}

/**
 * Pages one browser action may walk through `POST /v1/invoices/backfill`.
 * Each page scans at most 25 provider records and may take up to two minutes
 * upstream (faas pkg/api/limits.go:2763,2769), so the walk is bounded and the
 * cursor is handed back for the next action to resume from.
 */
export const BACKFILL_MAX_PAGES = 8;

export interface BackfillTotals {
  provider: InvoiceHistoryPage['provider'];
  scanned: number;
  imported: number;
  skipped: number;
  /** Set when the walk stopped at the page budget with provider history left. */
  nextCursor?: string;
}

/**
 * Import missing provider invoices, one bounded page at a time. Each page is
 * atomic and replay-safe upstream, so walking again from the start only skips
 * what is already stored.
 */
export function useBackfillInvoices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cursor: string | undefined): Promise<BackfillTotals> => {
      let next = cursor;
      let totals: BackfillTotals | undefined;
      for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
        const result = await unwrap(
          api.POST('/v1/invoices/backfill', {
            params: { query: next ? { cursor: next } : {} },
          })
        );
        totals = {
          provider: result.provider,
          scanned: (totals?.scanned ?? 0) + result.scanned,
          imported: (totals?.imported ?? 0) + result.imported,
          skipped: (totals?.skipped ?? 0) + result.skipped,
        };
        next = result.has_more ? result.next_cursor : undefined;
        if (!next) return totals;
      }
      return { ...totals!, nextCursor: next };
    },
    // Imported rows belong in the list even when a later page failed.
    onSettled: () => qc.invalidateQueries({ queryKey: keys.invoices }),
  });
}
