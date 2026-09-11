import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { useCronRuns, useDeleteCron } from './queries';

const api = vi.hoisted(() => ({ GET: vi.fn(), DELETE: vi.fn() }));
vi.mock('./client', async (original) => ({ ...(await original<object>()), api }));

describe('scheduled request deletion after viewing history', () => {
  it.each([false, true])(
    'only edits the list cache and rolls back on failure=%s',
    async (fails) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const rows = [{ id: 'schedule-1' }, { id: 'schedule-2' }];
      client.setQueryData(['crons'], rows);
      const history = { runs: [{ id: 'execution-1', outcome: 'success' }] };
      api.GET.mockResolvedValue({ data: history, response: new Response() });
      let settle!: () => void;
      api.DELETE.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            settle = () =>
              fails
                ? reject(new Error('delete offline'))
                : resolve({ data: undefined, response: new Response(null, { status: 204 }) });
          })
      );
      const view = renderHook(
        () => ({ history: useCronRuns('schedule-1'), remove: useDeleteCron() }),
        {
          wrapper: ({ children }) => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
          ),
        }
      );
      await waitFor(() => expect(view.result.current.history.isSuccess).toBe(true));
      const historyKey = ['crons', 'schedule-1', 'runs'];
      let pending!: Promise<unknown>;
      act(() => {
        pending = view.result.current.remove
          .mutateAsync('schedule-1')
          .catch((error: unknown) => error);
      });
      await waitFor(() =>
        expect(api.DELETE).toHaveBeenCalledWith('/v1/crons/{id}', {
          params: { path: { id: 'schedule-1' } },
        })
      );
      expect(client.getQueryData(['crons'])).toEqual([{ id: 'schedule-2' }]);
      expect(client.getQueryData(historyKey)).toEqual(history);
      // Inactive history must still be invalidated for the next visit.
      view.unmount();
      await act(async () => {
        settle();
        await pending;
      });
      expect(client.getQueryData(['crons'])).toEqual(fails ? rows : [{ id: 'schedule-2' }]);
      expect(client.getQueryData(historyKey)).toEqual(history);
      expect(client.getQueryState(historyKey)?.isInvalidated).toBe(true);
      client.clear();
      api.DELETE.mockClear();
    }
  );
});
