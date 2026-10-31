import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { capabilityKey } from '@/lib/api/capabilities';

const workspace = vi.hoisted(() => ({ org: null as string | null, label: 'Personal' }));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account', plan: 'pro' } }) }));
const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { PreviewsSettings } = await import('./previews-settings');

const items = [
  {
    key: 'realtime',
    label: 'Realtime',
    description: 'Channels.',
    retire_by: '2027-01-31',
    joined: false,
    eligible: true,
    enabled: false,
  },
  {
    key: 'events',
    label: 'Events',
    description: 'Event hub.',
    joined: true,
    eligible: true,
    enabled: true,
  },
  {
    key: 'gitlab',
    label: 'GitLab',
    description: 'GitLab deploys.',
    joined: false,
    eligible: false,
    enabled: false,
  },
];

type Call = { method: string; path: string; params?: unknown };
let calls: Call[] = [];
let joinRefusal: string | null = null;

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const refused = (status: number, code: string) => ({
  error: { code, title: code, status },
  response: new Response(JSON.stringify({ code, title: code, status }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  }),
});

beforeEach(() => {
  calls = [];
  joinRefusal = null;
  workspace.org = null;
  workspace.label = 'Personal';
  confirm.mockClear();
  for (const method of ['GET', 'PUT', 'DELETE'] as const)
    spyApi(method).mockImplementation(async (path: string, init?: unknown) => {
      calls.push({ method, path, params: (init as { params?: unknown })?.params });
      if (method === 'GET') return ok({ items });
      if (method === 'PUT' && joinRefusal) return refused(409, joinRefusal);
      return ok(items[0]);
    });
});
afterEach(() => vi.restoreAllMocks());

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <PreviewsSettings />
    </QueryClientProvider>
  );
  return spy;
}
const row = async (label: string) => (await screen.findByText(label)).closest('li')!;

describe('PreviewsSettings', () => {
  it('lists previews with their end date and joins an eligible one', async () => {
    const spy = renderPanel();
    const realtime = await row('Realtime');
    expect(realtime).toHaveTextContent('Channels.');
    expect(realtime).toHaveTextContent(new Date('2027-01-31').toLocaleDateString());
    await userEvent.click(within(realtime).getByRole('button', { name: 'Join' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'PUT', path: '/v1/previews/{key}' })
      )
    );
    expect(calls.find((c) => c.method === 'PUT')?.params).toMatchObject({
      path: { key: 'realtime' },
    });
    // Joining changes hidden_capabilities, so the gate must re-read them.
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: capabilityKey('account') }));
  });

  it('confirms before leaving', async () => {
    renderPanel();
    const events = await row('Events');
    expect(events).toHaveTextContent('Joined');
    await userEvent.click(within(events).getByRole('button', { name: 'Leave' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'DELETE', path: '/v1/previews/{key}' })
      )
    );
  });

  it('does not leave when the confirmation is cancelled', async () => {
    confirm.mockResolvedValueOnce(false);
    renderPanel();
    const events = await row('Events');
    await userEvent.click(within(events).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('explains an ineligible preview and a full one', async () => {
    joinRefusal = 'preview_full';
    renderPanel();
    const gitlab = await row('GitLab');
    expect(within(gitlab).getByRole('button', { name: 'Join' })).toBeDisabled();
    expect(gitlab).toHaveTextContent('Not available on your plan');
    const realtime = await row('Realtime');
    await userEvent.click(within(realtime).getByRole('button', { name: 'Join' }));
    expect(await within(realtime).findByRole('alert')).toHaveTextContent('This preview is full');
  });

  it('uses the organization routes in a company workspace', async () => {
    workspace.org = 'acme';
    workspace.label = 'Acme';
    renderPanel();
    expect(await screen.findByText('Previews for Acme')).toBeInTheDocument();
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: '/v1/orgs/{slug}/previews',
      params: { path: { slug: 'acme' } },
    });
  });
});
