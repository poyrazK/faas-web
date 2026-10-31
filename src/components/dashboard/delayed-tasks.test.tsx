import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from '@/test/api';

const cap = vi.hoisted(() => ({ access: 'on' as string, maturity: 'beta' as string }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: cap.access, refresh: vi.fn() }),
  useCapability: () => ({
    accountId: 'acct',
    state: 'available',
    capability: {
      key: 'delayed-execution',
      maturity: cap.maturity,
      docs_url: '/docs/event-driven#delayed-tasks',
    },
    refresh: vi.fn(),
  }),
}));

const { DelayedTasks } = await import('./delayed-tasks');

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const PENDING = 'a'.repeat(32);
const DONE = 'b'.repeat(32);
const OLDER = 'c'.repeat(32);
const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const problem = (status: number, code: string, detail: string) =>
  Promise.resolve({
    error: { type: 'about:blank', title: code, status, code, detail },
    response: new Response(null, { status }),
  });

function task(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    app_id: 'f'.repeat(32),
    scheduled_at: iso(2 * HOUR),
    state: 'pending',
    method: 'POST',
    path: '/send-reminder',
    created_at: iso(-3 * HOUR),
    ...extra,
  };
}

const page = {
  tasks: [
    task(PENDING),
    task(DONE, {
      state: 'completed',
      method: 'GET',
      path: '/month-close',
      scheduled_at: iso(-HOUR),
      created_at: iso(-26 * HOUR),
      attempts: 1,
      completed_at: iso(-HOUR),
    }),
  ],
};

function mount(children: ReactNode = <DelayedTasks slug="billing" />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function listRoute(get: ReturnType<typeof spyApi>, pages: unknown[]) {
  let n = 0;
  get.mockImplementation((path: string) => {
    if (path === '/v1/apps/{slug}/delayed-tasks') return ok(pages[Math.min(n++, pages.length - 1)]);
    return ok(undefined);
  });
}

beforeEach(() => {
  cap.access = 'on';
  cap.maturity = 'beta';
});
afterEach(() => vi.restoreAllMocks());

describe('DelayedTasks list', () => {
  it("lists the app's tasks with state, when each runs, its target and when it was created", async () => {
    listRoute(spyApi('GET'), [page]);
    mount();
    expect(await screen.findByText('POST /send-reminder')).toBeInTheDocument();
    expect(screen.getByText('GET /month-close')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('in 2h')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
    expect(screen.getByText('1d ago')).toBeInTheDocument();
  });

  it('says the list is empty rather than showing a session-only ledger', async () => {
    listRoute(spyApi('GET'), [{ tasks: [] }]);
    mount();
    expect(await screen.findByText(/no delayed tasks/i)).toBeInTheDocument();
    expect(screen.queryByText(/scheduled from this session/i)).not.toBeInTheDocument();
  });

  it('shows a failed read as an error, not as an empty list', async () => {
    spyApi('GET').mockImplementation(() =>
      problem(404, 'app_not_found', 'list delayed tasks failed')
    );
    mount();
    expect(await screen.findByText(/list delayed tasks failed/)).toBeInTheDocument();
    expect(screen.queryByText(/no delayed tasks/i)).not.toBeInTheDocument();
  });

  it('loads older tasks with the next_before cursor', async () => {
    const get = spyApi('GET');
    listRoute(get, [{ ...page, next_before: DONE }, { tasks: [task(OLDER, { path: '/older' })] }]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /load older tasks/i }));
    expect(await screen.findByText('POST /older')).toBeInTheDocument();
    expect(get).toHaveBeenLastCalledWith('/v1/apps/{slug}/delayed-tasks', {
      params: { path: { slug: 'billing' }, query: { limit: 20, before: DONE } },
    });
    expect(screen.queryByRole('button', { name: /load older tasks/i })).not.toBeInTheDocument();
  });

  it("labels the surface with the capability's maturity, not a fixed word", async () => {
    listRoute(spyApi('GET'), [page]);
    const view = mount();
    expect(await screen.findByText('Beta')).toBeInTheDocument();
    view.unmount();
    cap.maturity = 'ga';
    mount();
    await screen.findByText('POST /send-reminder');
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it("links the capability's documentation", async () => {
    listRoute(spyApi('GET'), [page]);
    mount();
    expect(await screen.findByRole('link', { name: /documentation/i })).toHaveAttribute(
      'href',
      '/docs/event-driven#delayed-tasks'
    );
  });

  it('does not read the list when the capability is not available to the account', () => {
    cap.access = 'plan-not-entitled';
    const get = spyApi('GET');
    mount();
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/not included in your plan/i);
  });
});

describe('DelayedTasks cancel', () => {
  it('offers cancel only on pending tasks, and asks before cancelling', async () => {
    listRoute(spyApi('GET'), [page]);
    const del = spyApi('DELETE').mockImplementation(() =>
      ok(task(PENDING, { state: 'cancelled' }))
    );
    mount();
    const buttons = await screen.findAllByRole('button', { name: /cancel task/i });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel task' }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith('/v1/delayed-tasks/{id}', {
        params: { path: { id: PENDING } },
      })
    );
    expect(await screen.findByText('Task cancelled')).toBeInTheDocument();
  });

  it('reports the state the API returned when the task had already started', async () => {
    listRoute(spyApi('GET'), [page]);
    spyApi('DELETE').mockImplementation(() => ok(task(PENDING, { state: 'dispatching' })));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /cancel task/i }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel task' })
    );
    expect(await screen.findByText(/already dispatching/i)).toBeInTheDocument();
    expect(screen.queryByText('Task cancelled')).not.toBeInTheDocument();
  });

  it('does nothing when the confirmation is dismissed', async () => {
    listRoute(spyApi('GET'), [page]);
    const del = spyApi('DELETE');
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /cancel task/i }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
    );
    expect(del).not.toHaveBeenCalled();
  });
});

describe('DelayedTasks detail', () => {
  it('opens one task by id with its attempts and last error', async () => {
    const get = spyApi('GET');
    get.mockImplementation((path: string) =>
      path === '/v1/delayed-tasks/{id}'
        ? ok(task(DONE, { state: 'failed', attempts: 3, last_error: 'upstream 503' }))
        : ok(page)
    );
    mount();
    await userEvent.click(await screen.findByText('GET /month-close'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/v1/delayed-tasks/{id}', { params: { path: { id: DONE } } })
    );
    expect(await within(dialog).findByText('upstream 503')).toBeInTheDocument();
    expect(within(dialog).getByText('3')).toBeInTheDocument();
    expect(within(dialog).getByText(DONE)).toBeInTheDocument();
  });
});

describe('DelayedTasks schedule', () => {
  it('schedules a request to the chosen method and path', async () => {
    listRoute(spyApi('GET'), [page]);
    const post = spyApi('POST').mockImplementation(() => ok(task(OLDER)));
    mount();
    await screen.findByText('POST /send-reminder');
    fireEvent.change(screen.getByLabelText(/run at/i), { target: { value: '2030-01-01T09:00' } });
    await userEvent.selectOptions(screen.getByLabelText(/method/i), 'PUT');
    const path = screen.getByLabelText(/^path/i);
    await userEvent.clear(path);
    await userEvent.type(path, '/internal/close-month');
    fireEvent.change(screen.getByLabelText(/json payload/i), {
      target: { value: '{"invoice_id":"inv_123"}' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/delayed-tasks', {
        params: { path: { slug: 'billing' } },
        body: {
          scheduled_at: new Date('2030-01-01T09:00').toISOString(),
          method: 'PUT',
          path: '/internal/close-month',
          payload: { invoice_id: 'inv_123' },
        },
      })
    );
    expect(await screen.findByText('Task scheduled')).toBeInTheDocument();
  });

  it('refuses a path that does not start with /', async () => {
    listRoute(spyApi('GET'), [page]);
    const post = spyApi('POST');
    mount();
    await screen.findByText('POST /send-reminder');
    fireEvent.change(screen.getByLabelText(/run at/i), { target: { value: '2030-01-01T09:00' } });
    const path = screen.getByLabelText(/^path/i);
    await userEvent.clear(path);
    await userEvent.type(path, 'internal');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByText(/path must start with \//i)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("names the plan's pending-task cap when the API refuses a new task", async () => {
    listRoute(spyApi('GET'), [page]);
    spyApi('POST').mockImplementation(() =>
      problem(
        403,
        'plan_delayed_tasks_cap',
        'the plan caps this app at 5 scheduled delayed_tasks; observed 5.'
      )
    );
    mount();
    await screen.findByText('POST /send-reminder');
    fireEvent.change(screen.getByLabelText(/run at/i), { target: { value: '2030-01-01T09:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByText(/pending-task limit/i)).toBeInTheDocument();
  });
});
