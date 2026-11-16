import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { ApiError } from './errors';
import {
  useSupportTickets,
  useSupportTicket,
  useSupportMessages,
  useSupportWrite,
  useMarkSupportRead,
  useSupportNotifications,
  useSupportCapabilities,
  sendSupportRequest,
  type SupportRequest,
} from './support';

const ok = (data: unknown) => ({ data, response: new Response() });
const personal = { accountId: 'alice', org: null };
const org = { accountId: 'alice', org: 'acme-corp' };
const receipt = { ticket_id: 'ticket', submission_id: 'receipt', revision: 2 };
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
afterEach(() => vi.restoreAllMocks());

describe('support reads', () => {
  it('waits for identity and isolates personal, organization and account caches', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ items: [] }));
    const { result, rerender } = renderHook(
      ({ scope }) => useSupportTickets(scope, { status: 'pending', search: 'invoice' }),
      { wrapper: wrapper(), initialProps: { scope: { accountId: '', org: null as string | null } } }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
    rerender({ scope: personal });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenLastCalledWith(
      '/v1/support/tickets',
      expect.objectContaining({
        headers: { 'X-Active-Org': '' },
        params: { query: { status: 'pending', search: 'invoice', cursor: undefined } },
      })
    );
    rerender({ scope: org });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        '/v1/orgs/{org}/support/tickets',
        expect.objectContaining({
          headers: { 'X-Active-Org': 'acme-corp' },
          params: {
            path: { org: 'acme-corp' },
            query: { status: 'pending', search: 'invoice', cursor: undefined },
          },
        })
      )
    );
    rerender({ scope: { ...org, accountId: 'bob' } });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  });

  it('passes list cursors and stops a repeated cursor', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ items: [], next_cursor: 'cursor' }));
    const { result } = renderHook(() => useSupportTickets(personal, {}), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());
    expect(get.mock.calls[1]?.[1]).toMatchObject({ params: { query: { cursor: 'cursor' } } });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });

  it('captures notification sequence before messages and uses a separate message cursor', async () => {
    const get = spyApi('GET').mockImplementation(async (path, options) => {
      if (path.endsWith('/notifications'))
        return ok({ items: [{ sequence: 800 }], unread_count: 1 });
      const after = (options as { params: { query: { after?: number } } }).params.query.after;
      return ok({ items: [{ sequence: after ? 71 : 70 }], ...(after ? {} : { next_cursor: 70 }) });
    });
    const { result } = renderHook(() => useSupportMessages(org, 'ticket'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/v1/orgs/{org}/support/notifications',
      '/v1/orgs/{org}/support/tickets/{ticket}/messages',
    ]);
    await act(() => result.current.fetchNextPage());
    expect(get.mock.calls[3]?.[1]).toMatchObject({
      params: { path: { org: 'acme-corp', ticket: 'ticket' }, query: { after: 70 } },
    });
    expect(result.current.data?.pages.at(-1)?.observedThrough).toBe(800);
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });

  it('reads conversation content when notifications fail without guessing a read boundary', async () => {
    spyApi('GET').mockImplementation(async (path) => {
      if (path.endsWith('/notifications')) throw new TypeError('offline');
      return ok({ items: [] });
    });
    const { result } = renderHook(() => useSupportMessages(personal, 'ticket'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0].observedThrough).toBe(0);
  });

  it('pages notifications with before and an explicit unread filter', async () => {
    const get = spyApi('GET')
      .mockResolvedValueOnce(ok({ items: [], next_cursor: 50, unread_count: 70 }))
      .mockResolvedValueOnce(ok({ items: [], unread_count: 70 }));
    const { result } = renderHook(() => useSupportNotifications(org, true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());
    expect(get.mock.calls[1]?.[1]).toMatchObject({
      params: { path: { org: 'acme-corp' }, query: { before: 50, unread: true } },
    });
  });

  it('checks preview availability in the URL scope rather than the selected workspace', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ capabilities: [] }));
    const { result } = renderHook(() => useSupportCapabilities(personal), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get.mock.calls[0]?.[1]).toMatchObject({ headers: { 'X-Active-Org': '' } });
  });
});

describe('support writes', () => {
  it('keeps actions locked until the accepted revision has refreshed', async () => {
    let finishRead: (value: ReturnType<typeof ok>) => void = () => {};
    const refreshed = new Promise<ReturnType<typeof ok>>((resolve) => {
      finishRead = resolve;
    });
    const get = spyApi('GET')
      .mockResolvedValueOnce(ok({ id: 'ticket', revision: 1 }))
      .mockReturnValue(refreshed);
    spyApi('POST').mockResolvedValue(ok(receipt));
    const { result } = renderHook(
      () => ({ ticket: useSupportTicket(personal, 'ticket'), write: useSupportWrite(personal) }),
      { wrapper: wrapper() }
    );
    await waitFor(() => expect(result.current.ticket.data?.revision).toBe(1));
    let pending: ReturnType<typeof result.current.write.run>;
    act(() => {
      pending = result.current.write.run({
        kind: 'reply',
        ticket: 'ticket',
        body: { expected_revision: 1, body: 'Reply' },
      });
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(result.current.write.locked).toBe(true);
    await act(async () => {
      finishRead(ok({ id: 'ticket', revision: 2 }));
      await pending;
    });
    await waitFor(() => expect(result.current.ticket.data?.revision).toBe(2));
    expect(result.current.write.locked).toBe(false);
  });
  it.each([personal, org])(
    'sends every customer action to its explicit scope: $org',
    async (scope) => {
      const post = spyApi('POST').mockResolvedValue(ok(receipt));
      const requests: [SupportRequest, string][] = [
        [
          { kind: 'create', body: { subject: 'Help', category: 'account', body: 'Details' } },
          '/tickets',
        ],
        [
          { kind: 'reply', ticket: 'ticket', body: { expected_revision: 2, body: 'Details' } },
          '/tickets/{ticket}/messages',
        ],
        [
          { kind: 'close', ticket: 'ticket', body: { expected_revision: 2 } },
          '/tickets/{ticket}/close',
        ],
        [
          {
            kind: 'reopen',
            ticket: 'ticket',
            body: { expected_revision: 2, body: 'Still broken' },
          },
          '/tickets/{ticket}/reopen',
        ],
        [
          { kind: 'rate', ticket: 'ticket', body: { episode_id: 'episode', rating: 4 } },
          '/tickets/{ticket}/satisfaction',
        ],
      ];
      for (const [request, suffix] of requests) {
        await sendSupportRequest(scope, request, 'retained-key');
        expect(post).toHaveBeenLastCalledWith(
          `${scope.org ? '/v1/orgs/{org}/support' : '/v1/support'}${suffix}`,
          expect.objectContaining({
            body: request.body,
            headers: { 'X-Active-Org': scope.org ?? '', 'Idempotency-Key': 'retained-key' },
            params: expect.objectContaining({ header: { 'Idempotency-Key': 'retained-key' } }),
          })
        );
      }
    }
  );

  it('keeps the exact body, revision and key after a lost response, without automatic retries', async () => {
    const post = spyApi('POST')
      .mockRejectedValueOnce(new TypeError('connection dropped'))
      .mockResolvedValue(ok(receipt));
    const { result } = renderHook(() => useSupportWrite(personal), { wrapper: wrapper() });
    const request: SupportRequest = {
      kind: 'reply',
      ticket: 'ticket',
      body: { expected_revision: 3, body: 'Original reply' },
    };
    await act(async () => {
      await expect(result.current.run(request)).rejects.toThrow();
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(result.current.locked).toBe(true);
    request.body.body = 'Changed text';
    request.body.expected_revision = 99;
    await act(() => result.current.retry());
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
    expect(post.mock.calls[1]?.[1]).toMatchObject({
      body: { body: 'Original reply', expected_revision: 3 },
    });
    expect(result.current.locked).toBe(false);
    await act(() => result.current.run(request));
    expect((post.mock.calls[2]?.[1] as { headers: unknown }).headers).not.toEqual(
      (post.mock.calls[0]?.[1] as { headers: unknown }).headers
    );
  });

  it('requires an explicit refresh after a revision conflict', async () => {
    spyApi('POST').mockRejectedValue(
      new ApiError({ status: 409, code: 'support_conflict', title: 'Changed' })
    );
    const { result } = renderHook(() => useSupportWrite(org), { wrapper: wrapper() });
    await act(async () => {
      await expect(
        result.current.run({ kind: 'close', ticket: 'ticket', body: { expected_revision: 3 } })
      ).rejects.toThrow();
    });
    expect(result.current.conflict).toBe(true);
    expect(result.current.locked).toBe(true);
    await act(() => result.current.resetAttempt());
    expect(result.current.locked).toBe(false);
  });

  it('marks only the observed boundary without a ticket revision', async () => {
    const post = spyApi('POST').mockResolvedValue(
      ok({ ticket_id: 'ticket', unread_count: 1, unread_total: 2 })
    );
    const { result } = renderHook(() => useMarkSupportRead(org, 'ticket'), { wrapper: wrapper() });
    await act(() => result.current.mutateAsync(44));
    expect(post).toHaveBeenCalledWith(
      '/v1/orgs/{org}/support/tickets/{ticket}/read',
      expect.objectContaining({
        body: { through_sequence: 44 },
        params: { path: { org: 'acme-corp', ticket: 'ticket' } },
      })
    );
  });
});
