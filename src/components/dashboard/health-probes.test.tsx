import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '@/lib/api/queries';
import type { Plan } from '@/lib/auth';
import { spyApi } from '@/test/api';
import { HealthProbes } from './health-probes';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

const web = {
  id: 'app-1',
  slug: 'api-gateway',
  type: 'app',
  manifest: { entrypoint: ['node', 'server.js'], port: 8080 },
} as unknown as App;
const worker = {
  ...web,
  slug: 'search-indexer',
  manifest: {
    entrypoint: ['node', 'worker.js'],
    execution_mode: 'worker',
    restart_policy: 'unless-stopped',
    stop_signal: 'SIGINT',
    // apid sends time.Duration as nanoseconds.
    stop_grace_period: 45_000_000_000,
  },
} as unknown as App;

const accepted = (body: object) => ({ data: body, response: new Response() }) as never;
const refused = (status: number, code: string, detail: string) =>
  ({
    error: { status, code, title: 'Refused', detail },
    response: new Response(null, { status }),
  }) as never;

const live = {
  id: 'dep-live',
  app_id: 'app-1',
  status: 'live',
  created_at: '2026-10-30T10:00:00Z',
  override_readiness_probe: { path: '/readyz', failure_threshold: 4 },
};
const deployments = (items: object[]) => accepted({ items, next_before: null });

function renderWith(app: App, plan: Plan | undefined = 'hobby') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HealthProbes app={app} plan={plan} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.toast.mockReset();
  spyApi('GET').mockResolvedValue(deployments([live]));
});

describe('HealthProbes', () => {
  it('shows the serving deployment probes, marking platform defaults, with what each does', async () => {
    renderWith(web);
    const probes = await screen.findByRole('list', { name: 'Probes' });
    const startup = within(probes).getByRole('listitem', { name: 'Startup check' });
    expect(startup).toHaveTextContent('TCP connect on port 8080');
    expect(startup).toHaveTextContent(/default/i);
    expect(startup).toHaveTextContent(/no traffic until it passes/i);

    const readiness = within(probes).getByRole('listitem', { name: 'Readiness probe' });
    expect(readiness).toHaveTextContent('GET /readyz');
    expect(readiness).toHaveTextContent('out of routing after 4 failures');
    expect(readiness).not.toHaveTextContent(/default/i);
    expect(readiness).toHaveTextContent(/without restarting/i);

    const liveness = within(probes).getByRole('listitem', { name: 'Liveness probe' });
    expect(liveness).toHaveTextContent('GET /healthz');
    expect(liveness).toHaveTextContent(/default/i);
    expect(liveness).toHaveTextContent(/destroyed and cold-booted/i);

    // Probes have no app-level write; the panel names where they are set.
    expect(screen.getByText('gregale deploy --healthcheck-path')).toBeInTheDocument();
    expect(screen.getByText('overrides.liveness_probe')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /deployment overrides/i })).toHaveAttribute(
      'href',
      '/docs/deploy-overrides'
    );
  });

  it('says probes come from the next deploy when nothing is serving yet', async () => {
    spyApi('GET').mockResolvedValue(deployments([{ ...live, status: 'building' }]));
    renderWith(web);
    expect(await screen.findByText(/no deployment is serving yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Probes' })).not.toBeInTheDocument();
  });

  it('reports a failed deployments read instead of guessing probes', async () => {
    spyApi('GET').mockResolvedValue(
      refused(403, 'insufficient_scope', 'This key cannot read deployments.')
    );
    renderWith(web);
    expect(await screen.findByText(/cannot read deployments/i)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Probes' })).not.toBeInTheDocument();
  });

  it('shows the restart contract with plan defaults marked, and the gregale.yaml keys', () => {
    renderWith(web, 'hobby');
    expect(screen.getByLabelText('Restart policy')).toHaveDisplayValue('Default (on-failure)');
    expect(screen.getByLabelText('Max retries')).toHaveValue(null);
    expect(screen.getByLabelText('Max retries')).toHaveAttribute('placeholder', '5 (default)');
    expect(screen.getByLabelText('Startup deadline (s)')).toHaveAttribute(
      'placeholder',
      '30 (default)'
    );
    expect(screen.getByLabelText('Stop signal')).toHaveDisplayValue('Default (SIGTERM)');
    expect(screen.getByLabelText('Grace period (s)')).toHaveAttribute(
      'placeholder',
      '30 (default)'
    );
    expect(screen.getByText(/marked failed as a crash loop/i)).toBeInTheDocument();
    expect(screen.getByText(/before it is killed/i)).toBeInTheDocument();
    const yaml = screen.getByLabelText('gregale.yaml lifecycle block');
    expect(yaml).toHaveTextContent('restart_policy: on-failure');
    expect(yaml).toHaveTextContent('stop_grace_period_s: 30');
  });

  it('reads stored values, and a worker has no default liveness probe', async () => {
    spyApi('GET').mockResolvedValue(deployments([{ ...live, override_readiness_probe: null }]));
    renderWith(worker, 'pro');
    expect(screen.getByLabelText('Restart policy')).toHaveDisplayValue('unless-stopped');
    expect(screen.getByLabelText('Stop signal')).toHaveDisplayValue('SIGINT');
    expect(screen.getByLabelText('Grace period (s)')).toHaveValue(45);
    expect(
      screen.getByText(/drain_timeout in gregale.yaml sets the same value/)
    ).toBeInTheDocument();
    const probes = await screen.findByRole('list', { name: 'Probes' });
    expect(within(probes).getByRole('listitem', { name: 'Liveness probe' })).toHaveTextContent(
      /workers and jobs have no HTTP endpoint/i
    );
  });

  it('offers no always policy to a job', () => {
    renderWith({ ...web, manifest: { entrypoint: ['run'], execution_mode: 'job' } } as App);
    const select = screen.getByLabelText('Restart policy');
    expect(within(select).queryByRole('option', { name: 'always' })).not.toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Default (no)' })).toBeInTheDocument();
  });

  it('saves only what changed, and says when each change applies', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(
      accepted({
        ...web,
        manifest: { ...web.manifest, restart_policy: 'always', stop_grace_period: 20e9 },
      })
    );
    const user = userEvent.setup();
    renderWith(web, 'hobby');
    expect(screen.getByRole('button', { name: 'Save restart settings' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Restart policy'), 'always');
    await user.type(screen.getByLabelText('Grace period (s)'), '20');
    await user.click(screen.getByRole('button', { name: 'Save restart settings' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toMatchObject({
      params: { path: { slug: 'api-gateway' } },
      body: { restart_policy: 'always', stop_grace_period_s: 20 },
    });
    expect(Object.keys((patch.mock.calls[0][1] as { body: object }).body)).toHaveLength(2);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.toast.mock.calls[0][0]).toMatchObject({ kind: 'success' });
    expect(mocks.toast.mock.calls[0][0].description).toMatch(/next deploy/i);
  });

  it('restores a default by sending the empty value apid reads as inherit', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(accepted(web));
    const user = userEvent.setup();
    renderWith(worker, 'pro');
    await user.selectOptions(screen.getByLabelText('Restart policy'), '');
    await user.clear(screen.getByLabelText('Grace period (s)'));
    await user.click(screen.getByRole('button', { name: 'Save restart settings' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect((patch.mock.calls[0][1] as { body: object }).body).toEqual({
      restart_policy: '',
      stop_grace_period_s: 0,
    });
  });

  it('refuses a value above the plan cap before it leaves the browser', async () => {
    const patch = spyApi('PATCH');
    const user = userEvent.setup();
    renderWith(web, 'hobby');
    await user.type(screen.getByLabelText('Grace period (s)'), '90');
    expect(screen.getByText('At most 30 s on the Hobby plan.')).toBeInTheDocument();
    expect(screen.getByLabelText('Grace period (s)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save restart settings' })).toBeDisabled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('shows apid’s reason when it refuses the change', async () => {
    spyApi('PATCH').mockResolvedValue(
      refused(
        400,
        'validation_failed',
        'app manifest: secret_reload_signal must differ from stop_signal "SIGHUP"'
      )
    );
    const user = userEvent.setup();
    renderWith(web, 'hobby');
    await user.selectOptions(screen.getByLabelText('Stop signal'), 'SIGHUP');
    await user.click(screen.getByRole('button', { name: 'Save restart settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/must differ from stop_signal/);
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
