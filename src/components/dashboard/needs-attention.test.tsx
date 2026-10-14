import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { NeedsAttentionContent, type NeedsAttentionProps } from './needs-attention';

const now = new Date('2026-10-10T10:00:00Z');
const ready = <T,>(data: T) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const app = (slug: string, status: string) => ({ id: `app-${slug}`, slug, status });
const deployment = (id: string, status = 'failed', created_at = '2026-10-10T09:00:00Z') => ({
  id,
  app_id: 'app-alpha',
  status,
  created_at,
});
function inputs(): NeedsAttentionProps {
  return {
    apps: ready([app('alpha', 'active')]),
    deployments: ready({ items: [] }),
    usage: ready({ month: '2026-10', used_gb_hours: 10, included_gb_hours: 50 }),
  };
}
async function mount(props = inputs()) {
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <NeedsAttentionContent {...props} />,
  });
  const leaf = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([
      index,
      leaf('/dashboard/workflows'),
      leaf('/dashboard/workflows/$workflowId'),
      leaf('/dashboard/deployments'),
      leaf('/dashboard/usage'),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}
const panel = () => within(screen.getByRole('region', { name: 'Needs attention' }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

describe('app failures', () => {
  it('links reported failures to the exact app logs, not parked or unknown states', async () => {
    const props = inputs();
    props.apps.data = [
      app('alpha', 'failed'),
      app('beta', 'ERROR'),
      app('gamma', 'crashed'),
      app('parked', 'parked'),
      app('unknown', 'new_status'),
      { ...app('deleted', 'failed'), deleted_at: '2026-10-09T09:00:00Z' },
    ];
    await mount(props);
    expect(panel().getByRole('link', { name: 'View logs for alpha' })).toHaveAttribute(
      'href',
      '/dashboard/workflows/alpha?tab=Logs'
    );
    expect(panel().getByRole('link', { name: 'View logs for beta' })).toHaveAttribute(
      'href',
      '/dashboard/workflows/beta?tab=Logs'
    );
    expect(panel().getByRole('link', { name: 'View logs for gamma' })).toBeInTheDocument();
    expect(panel().getAllByRole('link', { name: /View logs/ })).toHaveLength(3);
  });

  it('limits the list without concealing that more apps need attention', async () => {
    const props = inputs();
    props.apps.data = ['delta', 'gamma', 'beta', 'alpha'].map((slug) => app(slug, 'failed'));
    await mount(props);
    expect(panel().getAllByRole('link', { name: /View logs/ })).toHaveLength(3);
    expect(panel().getByText('Showing 3 of 4 failing apps.')).toBeInTheDocument();
    expect(panel().getByRole('link', { name: 'View all apps' })).toHaveAttribute(
      'href',
      '/dashboard/workflows'
    );
  });
});

describe('recent failed deployments', () => {
  it('excludes cancellations, unknown states, future timestamps and failures older than 24h', async () => {
    const props = inputs();
    props.deployments.data = {
      items: [
        deployment('recent'),
        deployment('boundary', 'failed', '2026-10-09T10:00:00Z'),
        deployment('old', 'failed', '2026-10-09T09:59:59Z'),
        deployment('cancelled', 'cancelled'),
        deployment('live', 'live'),
        deployment('unknown', 'new_status'),
        deployment('bad-time', 'failed', 'invalid'),
        deployment('future', 'failed', '2026-10-10T10:01:00Z'),
      ],
    };
    await mount(props);
    expect(panel().getByRole('link', { name: 'View deployment recent' })).toHaveAttribute(
      'href',
      '/dashboard/deployments?deployment=recent'
    );
    expect(panel().getByRole('link', { name: 'View deployment boundary' })).toBeInTheDocument();
    expect(panel().getAllByRole('link', { name: /View deployment / })).toHaveLength(2);
  });

  it('shows newest failures first and states the snapshot and display limits', async () => {
    const props = inputs();
    props.deployments.data = {
      items: [
        deployment('oldest', 'failed', '2026-10-10T06:00:00Z'),
        deployment('newest', 'failed', '2026-10-10T09:00:00Z'),
        deployment('third', 'failed', '2026-10-10T07:00:00Z'),
        deployment('second', 'failed', '2026-10-10T08:00:00Z'),
      ],
      next_before: 'older-page',
    };
    await mount(props);
    const links = panel().getAllByRole('link', { name: /View deployment / });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/dashboard/deployments?deployment=newest',
      '/dashboard/deployments?deployment=second',
      '/dashboard/deployments?deployment=third',
    ]);
    expect(panel().getByText('Showing 3 of 4 recent failed deployments.')).toBeInTheDocument();
    expect(panel().getByText(/latest 50 deployments/i)).toBeInTheDocument();
    expect(panel().getByRole('link', { name: 'Open deployment history' })).toHaveAttribute(
      'href',
      '/dashboard/deployments'
    );
  });

  it('keeps long identifiers out of visible actions while retaining exact accessible destinations', async () => {
    const props = inputs();
    const slug = 'an-app-with-a-long-but-valid-name-that-still-needs-investigation';
    const id = 'a37b02b7893dd248ba1e7ebb9e6a81ef';
    props.apps.data = [app(slug, 'failed')];
    props.deployments.data = { items: [deployment(id)] };
    await mount(props);
    expect(panel().getByRole('link', { name: `View deployment ${id}` })).not.toHaveTextContent(id);
    expect(panel().getByRole('link', { name: `View logs for ${slug}` })).not.toHaveTextContent(
      slug
    );
  });

  it('expires old notices while the page remains open', async () => {
    const props = inputs();
    props.deployments.data = { items: [deployment('boundary', 'failed', '2026-10-09T10:00:00Z')] };
    await mount(props);
    expect(panel().getByRole('link', { name: 'View deployment boundary' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(
      panel().queryByRole('link', { name: 'View deployment boundary' })
    ).not.toBeInTheDocument();
    expect(panel().getByText('No reported issues in the checked data.')).toBeInTheDocument();
  });
});

describe('compute allowance', () => {
  it('identifies unavailable checks rather than implying that failed reads are still loading', async () => {
    const props = inputs();
    props.usage.error = new Error('Usage read failed');
    await mount(props);
    expect(panel().getByText('Some checks are unavailable')).toBeInTheDocument();
    expect(panel().queryByText('Checking your workspace')).not.toBeInTheDocument();
  });
  it.each([40, 45, 49.999])('links low allowance to usage at %s of 50 GB-h used', async (used) => {
    const props = inputs();
    props.usage.data!.used_gb_hours = used;
    await mount(props);
    expect(panel().getByText('Compute allowance running low')).toBeInTheDocument();
    expect(panel().getByRole('link', { name: 'Review usage' })).toHaveAttribute(
      'href',
      '/dashboard/usage'
    );
    expect(panel().getByText(/2026-10/)).toBeInTheDocument();
    expect(panel().queryByText('Compute allowance exhausted')).not.toBeInTheDocument();
  });

  it.each([50, 60])(
    'reports exhaustion without asserting service stops or a billing forecast at %s GB-h',
    async (used) => {
      const props = inputs();
      props.usage.data!.used_gb_hours = used;
      await mount(props);
      expect(panel().getByText('Compute allowance exhausted')).toBeInTheDocument();
      expect(panel().getByText(/0 GB-h remaining/)).toBeInTheDocument();
      expect(panel().queryByText(/will stop|forecast|estimated/i)).not.toBeInTheDocument();
    }
  );

  it('does not flag a healthy allowance just below the threshold', async () => {
    const props = inputs();
    props.usage.data!.used_gb_hours = 39.999;
    await mount(props);
    expect(panel().queryByRole('link', { name: 'Review usage' })).not.toBeInTheDocument();
    expect(panel().getByText('No reported issues in the checked data.')).toBeInTheDocument();
  });

  it.each([0, 2])(
    'handles zero included allowance with %s used without dividing by zero',
    async (used) => {
      const props = inputs();
      props.usage.data = { month: '2026-10', used_gb_hours: used, included_gb_hours: 0 };
      await mount(props);
      expect(panel().getByText('No compute allowance included')).toBeInTheDocument();
      expect(panel().getByRole('link', { name: 'Review usage' })).toBeInTheDocument();
      expect(panel().queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
    }
  );

  it.each([-1, NaN, Infinity])(
    'treats invalid usage %s as unavailable rather than healthy',
    async (used) => {
      const props = inputs();
      props.usage.data!.used_gb_hours = used;
      await mount(props);
      expect(panel().getByText('Compute allowance unavailable.')).toBeInTheDocument();
      expect(
        panel().queryByText('No reported issues in the checked data.')
      ).not.toBeInTheDocument();
    }
  );
});

describe('independent read states', () => {
  it('keeps known failures while usage is pending, without claiming all clear', async () => {
    const props = inputs();
    props.apps.data = [app('alpha', 'failed')];
    props.usage = { ...props.usage, data: undefined, isPending: true };
    await mount(props);
    expect(panel().getByRole('link', { name: 'View logs for alpha' })).toBeInTheDocument();
    expect(panel().getByText('Checking compute allowance…')).toBeInTheDocument();
    expect(panel().queryByText('No reported issues in the checked data.')).not.toBeInTheDocument();
  });

  it.each(['apps', 'deployments', 'usage'] as const)(
    'suppresses stale %s data after a read failure and offers retry',
    async (source) => {
      const props = inputs();
      props.apps.data = [app('alpha', 'failed')];
      props.deployments.data = { items: [deployment('stale')] };
      props.usage.data!.used_gb_hours = 50;
      props[source].error = new Error('Read failed');
      await mount(props);
      const labels = {
        apps: 'App status',
        deployments: 'Deployment history',
        usage: 'Compute allowance',
      };
      expect(panel().getByText(`${labels[source]} unavailable.`)).toBeInTheDocument();
      const staleLink = {
        apps: 'View logs for alpha',
        deployments: 'View deployment stale',
        usage: 'Review usage',
      };
      expect(panel().queryByRole('link', { name: staleLink[source] })).not.toBeInTheDocument();
      await userEvent.click(
        panel().getByRole('button', { name: `Retry ${labels[source].toLowerCase()}` })
      );
      expect(props[source].refetch).toHaveBeenCalledTimes(1);
      expect(
        panel().queryByText('No reported issues in the checked data.')
      ).not.toBeInTheDocument();
    }
  );

  it('distinguishes an unreachable API from an empty app list', async () => {
    const props = inputs();
    props.apps = {
      ...props.apps,
      data: undefined,
      error: new ApiError({ status: 502, code: 'http_502', title: 'Bad gateway' }),
    };
    await mount(props);
    expect(panel().getByText('App status unreachable.')).toBeInTheDocument();
    expect(panel().queryByText('No reported issues in the checked data.')).not.toBeInTheDocument();
  });
});
