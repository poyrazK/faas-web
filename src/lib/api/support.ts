import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError, errorMessage } from './errors';
import type { components } from './schema';

type S = components['schemas'];
export type SupportTicket = S['SupportTicket'];
export type SupportScope = { accountId: string; org: string | null };
export type SupportFilters = { status?: SupportTicket['status']; search?: string };
export type SupportRequest =
  | { kind: 'create'; body: S['CreateSupportTicketRequest'] }
  | { kind: 'reply' | 'reopen'; ticket: string; body: S['SupportMessageRequest'] }
  | { kind: 'close'; ticket: string; body: S['CloseSupportTicketRequest'] }
  | { kind: 'rate'; ticket: string; body: S['SupportSatisfactionRequest'] };

export const supportKey = (scope: SupportScope) => ['support', scope.accountId, scope.org] as const;
// Explicit route scope wins over the console's workspace header, including a
// personal email link opened while the workspace switcher points at a company.
const headers = (scope: SupportScope) => ({ 'X-Active-Org': scope.org ?? '' });
const path = (scope: SupportScope, ticket: string) => ({ org: scope.org!, ticket });
const enabled = (scope: SupportScope) => Boolean(scope.accountId);
const nextCursor = <T extends string | number>(next: T | undefined, cursors: (T | undefined)[]) =>
  next && !cursors.includes(next) ? next : undefined;

export function useSupportCapabilities(scope: SupportScope) {
  return useQuery({
    queryKey: [...supportKey(scope), 'capabilities'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/capabilities', { signal, headers: headers(scope) })),
    enabled: enabled(scope),
    retry: false,
  });
}

export function useSupportTickets(scope: SupportScope, filters: SupportFilters) {
  return useInfiniteQuery({
    queryKey: [...supportKey(scope), 'tickets', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const query = { ...filters, cursor: pageParam };
      const init = { signal, headers: headers(scope) };
      return scope.org
        ? unwrap(
            api.GET('/v1/orgs/{org}/support/tickets', {
              ...init,
              params: { path: { org: scope.org }, query },
            })
          )
        : unwrap(api.GET('/v1/support/tickets', { ...init, params: { query } }));
    },
    getNextPageParam: (page, _pages, _last, cursors) => nextCursor(page.next_cursor, cursors),
    enabled: enabled(scope),
    retry: false,
    gcTime: 0,
    refetchInterval: 30_000,
  });
}

export function useSupportTicket(scope: SupportScope, ticket: string) {
  return useQuery({
    queryKey: [...supportKey(scope), 'ticket', ticket],
    queryFn: ({ signal }) => {
      const init = { signal, headers: headers(scope), params: { path: path(scope, ticket) } };
      return scope.org
        ? unwrap(api.GET('/v1/orgs/{org}/support/tickets/{ticket}', init))
        : unwrap(api.GET('/v1/support/tickets/{ticket}', init));
    },
    enabled: enabled(scope) && Boolean(ticket),
    retry: false,
    gcTime: 0,
    refetchInterval: 30_000,
  });
}

function notifications(
  scope: SupportScope,
  before?: number,
  signal?: AbortSignal,
  unread?: boolean
) {
  const init = { signal, headers: headers(scope) };
  const query = { before, unread };
  return scope.org
    ? unwrap(
        api.GET('/v1/orgs/{org}/support/notifications', {
          ...init,
          params: { path: { org: scope.org }, query },
        })
      )
    : unwrap(api.GET('/v1/support/notifications', { ...init, params: { query } }));
}

export function useSupportNotifications(scope: SupportScope, unread = false) {
  return useInfiniteQuery({
    queryKey: [...supportKey(scope), 'notifications', unread],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) => notifications(scope, pageParam, signal, unread),
    getNextPageParam: (page, _pages, _last, cursors) => nextCursor(page.next_cursor, cursors),
    enabled: enabled(scope),
    retry: false,
    gcTime: 0,
    refetchInterval: 30_000,
  });
}

export function useSupportMessages(scope: SupportScope, ticket: string) {
  return useInfiniteQuery({
    queryKey: [...supportKey(scope), 'messages', ticket],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      // Notification and message sequences are different counters. Capture a
      // notification boundary BEFORE reading messages, never after rendering:
      // a reply that races the read must remain unread until it is displayed.
      let observedThrough = 0;
      try {
        const updates = await notifications(scope, undefined, signal, true);
        observedThrough = Math.max(0, ...updates.items.map((item) => item.sequence));
      } catch (error) {
        if (signal.aborted) throw error;
        // Conversation access should survive an unavailable notification read.
      }
      const init = {
        signal,
        headers: headers(scope),
        params: { path: path(scope, ticket), query: { after: pageParam } },
      };
      const page = scope.org
        ? await unwrap(api.GET('/v1/orgs/{org}/support/tickets/{ticket}/messages', init))
        : await unwrap(api.GET('/v1/support/tickets/{ticket}/messages', init));
      return { ...page, observedThrough };
    },
    getNextPageParam: (page, _pages, _last, cursors) => nextCursor(page.next_cursor, cursors),
    enabled: enabled(scope) && Boolean(ticket),
    retry: false,
    gcTime: 0,
    refetchInterval: 30_000,
  });
}

export function useSupportSurvey(scope: SupportScope, ticket: string) {
  return useQuery({
    queryKey: [...supportKey(scope), 'survey', ticket],
    queryFn: ({ signal }) => {
      const init = { signal, headers: headers(scope), params: { path: path(scope, ticket) } };
      return scope.org
        ? unwrap(api.GET('/v1/orgs/{org}/support/tickets/{ticket}/satisfaction', init))
        : unwrap(api.GET('/v1/support/tickets/{ticket}/satisfaction', init));
    },
    enabled: enabled(scope) && Boolean(ticket),
    retry: false,
    gcTime: 0,
  });
}

export async function sendSupportRequest(
  scope: SupportScope,
  request: SupportRequest,
  key: string
): Promise<S['SupportSubmission'] | S['SupportSatisfactionSubmission']> {
  const init = { headers: { ...headers(scope), 'Idempotency-Key': key } };
  if (request.kind === 'create') {
    const options = {
      ...init,
      body: request.body,
      params: { path: { org: scope.org! }, header: { 'Idempotency-Key': key } },
    };
    return scope.org
      ? unwrap(api.POST('/v1/orgs/{org}/support/tickets', options))
      : unwrap(
          api.POST('/v1/support/tickets', {
            ...init,
            body: request.body,
            params: { header: { 'Idempotency-Key': key } },
          })
        );
  }
  const params = { path: path(scope, request.ticket), header: { 'Idempotency-Key': key } };
  switch (request.kind) {
    case 'reply':
      return scope.org
        ? unwrap(
            api.POST('/v1/orgs/{org}/support/tickets/{ticket}/messages', {
              ...init,
              params,
              body: request.body,
            })
          )
        : unwrap(
            api.POST('/v1/support/tickets/{ticket}/messages', {
              ...init,
              params,
              body: request.body,
            })
          );
    case 'close':
      return scope.org
        ? unwrap(
            api.POST('/v1/orgs/{org}/support/tickets/{ticket}/close', {
              ...init,
              params,
              body: request.body,
            })
          )
        : unwrap(
            api.POST('/v1/support/tickets/{ticket}/close', { ...init, params, body: request.body })
          );
    case 'reopen':
      return scope.org
        ? unwrap(
            api.POST('/v1/orgs/{org}/support/tickets/{ticket}/reopen', {
              ...init,
              params,
              body: request.body,
            })
          )
        : unwrap(
            api.POST('/v1/support/tickets/{ticket}/reopen', { ...init, params, body: request.body })
          );
    case 'rate':
      return scope.org
        ? unwrap(
            api.POST('/v1/orgs/{org}/support/tickets/{ticket}/satisfaction', {
              ...init,
              params,
              body: request.body,
            })
          )
        : unwrap(
            api.POST('/v1/support/tickets/{ticket}/satisfaction', {
              ...init,
              params,
              body: request.body,
            })
          );
  }
}

export function supportError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'support_forbidden')
      return 'Support requires a verified account. Organization conversations are available to owners and admins.';
    if (error.code === 'support_not_found')
      return 'This conversation is not available in this support workspace.';
    if (error.code === 'support_conflict')
      return 'This conversation changed. Load the latest version, review it, then send again. Your draft is kept.';
  }
  return errorMessage(error);
}

const REJECTED = new Set([
  'support_invalid',
  'support_request_too_large',
  'support_rate_limited',
  'support_notification_recipients_limited',
  'support_forbidden',
  'support_not_found',
  'forbidden',
  'email_not_verified',
  'feature_disabled',
  'rate_limited',
]);

/** Retains the exact request, revision and UUID until it is answered. No replay
 * on mount or network reconnection, and no conversation text in browser storage. */
export function useSupportWrite(scope: SupportScope) {
  const qc = useQueryClient();
  const attempt = useRef<{ request: SupportRequest; key: string } | null>(null);
  const [locked, setLocked] = useState(false);
  const mutation = useMutation({
    mutationFn: (next: { request: SupportRequest; key: string }) =>
      sendSupportRequest(scope, next.request, next.key),
    retry: false,
    gcTime: 0,
    onSuccess: async () => {
      // Keep actions locked until the accepted revision has been re-read. A
      // fast second action could otherwise submit the previous revision while
      // the independently fetched message list already shows the new reply.
      await qc.invalidateQueries({ queryKey: supportKey(scope) });
      attempt.current = null;
      setLocked(false);
    },
  });
  const run = (request: SupportRequest) => {
    if (!attempt.current)
      attempt.current = { request: structuredClone(request), key: crypto.randomUUID() };
    setLocked(true);
    return mutation.mutateAsync(attempt.current);
  };
  const code = mutation.error instanceof ApiError ? mutation.error.code : '';
  return {
    ...mutation,
    locked,
    run,
    retry: () => (attempt.current ? run(attempt.current.request) : Promise.resolve(undefined)),
    conflict: code === 'support_conflict',
    rejected: REJECTED.has(code),
    resetAttempt: async () => {
      if (code === 'support_conflict') await qc.invalidateQueries({ queryKey: supportKey(scope) });
      attempt.current = null;
      setLocked(false);
      mutation.reset();
    },
  };
}

export function useMarkSupportRead(scope: SupportScope, ticket: string) {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (through: number) => {
      const init = {
        headers: headers(scope),
        params: { path: path(scope, ticket) },
        body: { through_sequence: through },
      };
      return scope.org
        ? unwrap(api.POST('/v1/orgs/{org}/support/tickets/{ticket}/read', init))
        : unwrap(api.POST('/v1/support/tickets/{ticket}/read', init));
    },
    onSuccess: () => {
      for (const part of ['tickets', 'ticket', 'notifications'])
        void qc.invalidateQueries({ queryKey: [...supportKey(scope), part] });
    },
  });
}
