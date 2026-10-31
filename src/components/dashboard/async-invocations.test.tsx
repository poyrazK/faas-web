import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ToastProvider } from '@/components/ui/toast';
import type { Invocation } from '@/lib/api/async-invocations';
import { spyApi } from '@/test/api';

const cap = vi.hoisted(() => ({ maturity: 'beta' as string | undefined }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({
    access: 'on',
    capability: cap.maturity ? { key: 'async-invocations', maturity: cap.maturity } : undefined,
    refresh: vi.fn(),
  }),
}));

const { AsyncInvocationsMaturity, InvocationDelivery, ReplayInvocationButton } =
  await import('./async-invocations');

const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const problem = (status: number, code: string, detail: string) =>
  Promise.resolve({
    error: { type: 'about:blank', title: code, status, code, detail },
    response: new Response(null, { status }),
  });

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const PARENT = 'a'.repeat(32);
const CHILD = 'c'.repeat(32);
const OK_HOOK = '11111111-1111-4111-8111-111111111111';
const FAIL_HOOK = '22222222-2222-4222-8222-222222222222';

function invocation(extra: Partial<Invocation> = {}): Invocation {
  return {
    id: PARENT,
    app_id: 'app1',
    account_id: 'acct',
    source: 'async_invoke' as const,
    state: 'failed' as const,
    created_at: iso(-HOUR),
    ...extra,
  };
}

function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  cap.maturity = 'beta';
});
afterEach(() => vi.restoreAllMocks());

describe('ReplayInvocationButton', () => {
  it('replays failed keyed work through replay-keyed, after naming its lane', async () => {
    const post = spyApi('POST').mockImplementation(() =>
      ok({ id: CHILD, status_url: `/v1/invocations/${CHILD}` })
    );
    mount(
      <ReplayInvocationButton invocation={invocation({ work_policy_name: 'document-index' })} />
    );
    await userEvent.click(screen.getByRole('button', { name: /Replay invocation/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('document-index');
    expect(dialog).toHaveTextContent(/same replay/);
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replay' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/invocations/{id}/replay-keyed', {
        params: { path: { id: PARENT } },
      })
    );
    expect(post).not.toHaveBeenCalledWith('/v1/invocations/{id}/replay', expect.anything());
    expect(await screen.findByText('Replay queued')).toBeInTheDocument();
  });

  it('replays unkeyed work through plain replay', async () => {
    const post = spyApi('POST').mockImplementation(() =>
      ok({ id: CHILD, status_url: `/v1/invocations/${CHILD}` })
    );
    mount(<ReplayInvocationButton invocation={invocation({ state: 'dead_letter' })} />);
    await userEvent.click(screen.getByRole('button', { name: /Replay invocation/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Replay',
      })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/invocations/{id}/replay', {
        params: { path: { id: PARENT } },
      })
    );
  });

  it('sends nothing when the confirmation is dismissed', async () => {
    const post = spyApi('POST');
    mount(<ReplayInvocationButton invocation={invocation()} />);
    await userEvent.click(screen.getByRole('button', { name: /Replay invocation/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Cancel',
      })
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('explains an expired keyed lane by its code', async () => {
    spyApi('POST').mockImplementation(() =>
      problem(409, 'keyed_replay_expired', 'the original pending deadline has elapsed')
    );
    mount(<ReplayInvocationButton invocation={invocation({ work_policy_name: 'p' })} />);
    await userEvent.click(screen.getByRole('button', { name: /Replay invocation/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Replay',
      })
    );
    expect(await screen.findByText('Could not replay')).toBeInTheDocument();
    expect(screen.getByText(/pending lifetime has passed/)).toBeInTheDocument();
    // The error itself goes to the toast, so its code and help come with it.
    expect(screen.getByText(/keyed_replay_expired/)).toBeInTheDocument();
  });

  it('shows the server prose and code for a refusal without its own copy', async () => {
    spyApi('POST').mockImplementation(() =>
      problem(409, 'invocation_not_replayable', 'invocation is completed')
    );
    mount(<ReplayInvocationButton invocation={invocation()} />);
    await userEvent.click(screen.getByRole('button', { name: /Replay invocation/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replay' })
    );
    expect(await screen.findByText('invocation is completed')).toBeInTheDocument();
    expect(screen.getByText(/invocation_not_replayable/)).toBeInTheDocument();
  });

  it('disables the icon while its replay is in flight', async () => {
    let settle: (value: unknown) => void = () => undefined;
    spyApi('POST').mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        })
    );
    mount(<ReplayInvocationButton invocation={invocation()} />);
    const icon = screen.getByRole('button', { name: /Replay invocation/ });
    await userEvent.click(icon);
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replay' })
    );
    await waitFor(() => expect(icon).toBeDisabled());
    settle({ data: { id: CHILD, status_url: '' }, response: new Response() });
    await waitFor(() => expect(icon).not.toBeDisabled());
  });

  it('offers no icon for work that cannot be replayed here', () => {
    mount(<ReplayInvocationButton invocation={invocation({ state: 'completed' })} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says why in the full variant', () => {
    mount(
      <ReplayInvocationButton
        variant="full"
        invocation={invocation({ state: 'dead_letter', work_policy_name: 'p' })}
      />
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/dead-letter queue/)).toBeInTheDocument();
  });

  it('tells keyed and plain replay apart in one line in the full variant', () => {
    mount(
      <ReplayInvocationButton variant="full" invocation={invocation({ work_policy_name: 'p' })} />
    );
    expect(screen.getByRole('button', { name: /Replay in lane/ })).toBeInTheDocument();
    expect(screen.getByText(/joins its work-policy lane/)).toBeInTheDocument();
  });
});

describe('InvocationDelivery', () => {
  it('shows the work policy, lifetimes and destinations, naming webhooks by target', async () => {
    const get = spyApi('GET').mockImplementation((path: string) =>
      path === '/v1/apps/{slug}/webhooks'
        ? ok([{ id: OK_HOOK, target_url: 'https://hooks.example.com/done' }])
        : ok(undefined)
    );
    mount(
      <InvocationDelivery
        appSlug="docs"
        invocation={invocation({
          work_policy_name: 'document-index',
          work_policy_revision: 3,
          work_expires_at: iso(2 * HOUR),
          deadline_at: iso(HOUR),
          on_success_destination_id: OK_HOOK,
          on_failure_destination_id: FAIL_HOOK,
        })}
      />
    );
    expect(screen.getByText('document-index')).toBeInTheDocument();
    expect(screen.getByText(/revision 3/)).toBeInTheDocument();
    expect(screen.getByText('Pending expiry')).toBeInTheDocument();
    expect(screen.getByText('Deadline')).toBeInTheDocument();
    expect(await screen.findByText('https://hooks.example.com/done')).toBeInTheDocument();
    // A destination this app no longer lists still shows its id.
    expect(screen.getByText(FAIL_HOOK)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/webhooks', expect.anything());
  });

  it('says plainly when there is no policy or destination', () => {
    spyApi('GET').mockImplementation(() => ok([]));
    mount(
      <InvocationDelivery appSlug="docs" invocation={invocation({ deadline_at: iso(HOUR) })} />
    );
    expect(screen.getByText('Work policy')).toBeInTheDocument();
    expect(screen.getAllByText('None').length).toBeGreaterThanOrEqual(2);
  });

  it('does not read webhooks when no destination is set', () => {
    const get = spyApi('GET');
    mount(<InvocationDelivery appSlug="docs" invocation={invocation()} />);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('AsyncInvocationsMaturity', () => {
  it('labels the surface from the capability maturity', () => {
    mount(<AsyncInvocationsMaturity />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows nothing for a GA capability', () => {
    cap.maturity = 'ga';
    mount(<AsyncInvocationsMaturity />);
    expect(screen.queryByText(/^(Beta|Preview)$/)).not.toBeInTheDocument();
  });
});
