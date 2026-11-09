import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deployment } from '@/lib/api/queries';

let items: Deployment[] = [];
const recoverAct = vi.fn();
const rollbackStart = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useAppDeployments: () => ({
    data: { pages: [{ items }] },
    isPending: false,
    error: null,
    hasNextPage: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('./rollout-recovery', () => ({
  useRolloutRecovery: () => ({ act: recoverAct, refusal: null, isPending: false }),
}));
vi.mock('./rollback-status', () => ({
  useRollbackFlow: () => ({
    start: rollbackStart,
    operation: null,
    operationLabel: '',
    isPending: false,
  }),
  RollbackStatus: () => null,
}));

const { DeploymentHistoryPanel } = await import('./deployment-history');

function dep(over: Partial<Deployment>): Deployment {
  return {
    id: 'dep',
    app_id: 'app-1',
    image_digest: 'sha256:aaaaaaaaaa',
    kind: 'github',
    status: 'live',
    created_at: '2026-09-11T00:00:00Z',
    ...over,
  };
}

const canary = dep({
  id: 'canary',
  revision: 43,
  created_at: '2026-11-09T08:00:00Z',
  image_digest: 'sha256:f35835e111',
  commit_sha: 'abc1234def',
  canary_preset: 'balanced',
  canary_step: 1,
  canary_total_steps: 4,
  rollout_state: 'rolling_out',
  traffic_percent: 10,
});
const current = dep({
  id: 'current',
  revision: 42,
  image_digest: 'sha256:9d0c1e2000',
  traffic_percent: 90,
});
const replaced = dep({
  id: 'old',
  revision: 41,
  image_digest: 'sha256:700ef9f000',
  status: 'superseded',
});
const failed = dep({ id: 'bad', image_digest: 'sha256:e74b389000', status: 'failed' });

beforeEach(() => {
  recoverAct.mockReset();
  rollbackStart.mockReset();
  items = [canary, current, replaced, failed];
});

function renderPanel(onSelect = vi.fn()) {
  render(
    <DeploymentHistoryPanel
      slug="api"
      buildTimings={
        new Map([
          ['current', { durationSeconds: 38 }],
          ['old', { durationSeconds: 247 }],
        ])
      }
      onSelect={onSelect}
      cleanup={<button type="button">Clean up old versions</button>}
    />
  );
  return onSelect;
}

describe('Deployment history', () => {
  it('leads with the rollout in a sentence, the version it replaces and the next step', () => {
    renderPanel();
    const now = screen.getByRole('region', { name: "What's happening now" });
    expect(within(now).getByText('A new version is getting 10% of traffic')).toBeInTheDocument();
    expect(
      within(now).getByText(/The rest stays on v42\. The next step is 50%\./)
    ).toBeInTheDocument();
  });

  it('draws the rollout steps from the preset ladder', () => {
    renderPanel();
    const steps = screen.getByRole('list', { name: 'Rollout step 2 of 4' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['1% (done)', '10% · now', '50%', '100%']);
  });

  it('wires the rollout actions to the existing recovery', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Send all traffic now' }));
    expect(recoverAct).toHaveBeenCalledWith('promote');
    await userEvent.click(screen.getByRole('button', { name: 'Roll back' }));
    expect(recoverAct).toHaveBeenCalledWith('abort');
  });

  it('opens the rollout’s details from the quiet source line', async () => {
    const onSelect = renderPanel();
    const now = screen.getByRole('region', { name: "What's happening now" });
    expect(now).toHaveTextContent(/from GitHub · commit abc1234 · image f35835e/);
    await userEvent.click(within(now).getByRole('button', { name: /^Details/ }));
    expect(onSelect).toHaveBeenCalledWith('canary');
  });

  it('lists other versions with plain status words, the raw status on hover, and build time', () => {
    renderPanel();
    const list = screen.getByRole('region', { name: 'Other versions' });
    const currentWord = within(list).getByText('Current version (serving 90%)');
    expect(currentWord).toHaveAttribute('title', 'live');
    expect(within(list).getByText('Replaced')).toHaveAttribute('title', 'superseded');
    expect(within(list).getByText('Failed')).toHaveAttribute('title', 'failed');
    expect(list).toHaveTextContent('built in 38 s');
    expect(list).toHaveTextContent('built in 4 min');
    expect(list).not.toHaveTextContent('247.0s');
    // The rollout is the headline, not a second "live" row.
    expect(within(list).queryByText(/getting 10%/)).toBeNull();
  });

  it('offers “Roll back to this” only on replaced versions, through the checked rollback', async () => {
    renderPanel();
    const buttons = screen.getAllByRole('button', { name: /^Roll back to this/ });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Roll back to this (v41)');
    await userEvent.click(buttons[0]);
    expect(rollbackStart).toHaveBeenCalledWith('old', 'v41');
  });

  it('selects a row to open its release drawer', async () => {
    const onSelect = renderPanel();
    await userEvent.click(screen.getByText('Replaced'));
    expect(onSelect).toHaveBeenCalledWith('old');
  });

  it('names the well’s version and time exactly as its row would, from the API revision', () => {
    renderPanel();
    const now = screen.getByRole('region', { name: "What's happening now" });
    expect(now).toHaveTextContent(/v43 deployed .* from GitHub/);
    expect(within(now).getByRole('time')).toHaveAttribute('dateTime', '2026-11-09T08:00:00.000Z');
    const list = screen.getByRole('region', { name: 'Other versions' });
    expect(list).toHaveTextContent('Current version (serving 90%) · v42 · 9d0c1e2');
  });

  it('does not repeat the deployment the well describes as a row', () => {
    renderPanel();
    const list = screen.getByRole('region', { name: 'Other versions' });
    expect(list).not.toHaveTextContent('v43');
    expect(list).not.toHaveTextContent('f35835e');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('keeps a release in another environment as its own, labelled row', () => {
    const staging = dep({
      id: 'staging',
      revision: 44,
      scope: 'staging',
      image_digest: 'sha256:5a5a5a5000',
      traffic_percent: 100,
    });
    items = [staging, canary, current, replaced];
    renderPanel();
    const now = screen.getByRole('region', { name: "What's happening now" });
    expect(now).toHaveTextContent(/v43 deployed/);
    const list = screen.getByRole('region', { name: 'Other versions' });
    expect(list).toHaveTextContent('Live in staging (serving 100%) · v44 · 5a5a5a5');
    expect(list).not.toHaveTextContent('v43');
  });

  it('falls back to the short deployment id everywhere when there is no revision', async () => {
    items = [
      dep({ id: 'live-0001-xyz', traffic_percent: 100 }),
      dep({ id: 'gone-0002-xyz', status: 'superseded' }),
    ];
    renderPanel();
    expect(screen.getByText('Live: live-000')).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Other versions' });
    expect(list).toHaveTextContent('Replaced · gone-000');
    await userEvent.click(within(list).getByRole('button', { name: /^Roll back to this/ }));
    expect(rollbackStart).toHaveBeenCalledWith('gone-0002-xyz', 'gone-000');
  });

  it('says plainly what is live when no rollout runs', () => {
    items = [dep({ id: 'live', revision: 12, traffic_percent: 100 }), replaced];
    renderPanel();
    expect(screen.getByText('Live: v12')).toBeInTheDocument();
    expect(screen.getByText('Serving all traffic.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send all traffic now' })).toBeNull();
  });

  it('keeps the clean-up control beside the list', () => {
    renderPanel();
    const list = screen.getByRole('region', { name: 'Other versions' });
    expect(within(list).getByRole('button', { name: 'Clean up old versions' })).toBeInTheDocument();
  });

  it('shows each row time with the exact time on hover', () => {
    items = [dep({ id: 'live', traffic_percent: 100 }), replaced];
    renderPanel();
    const list = screen.getByRole('region', { name: 'Other versions' });
    const when = within(list).getByRole('time');
    expect(when).toHaveAttribute('dateTime', '2026-09-11T00:00:00.000Z');
    expect(when).toHaveAttribute('title', expect.stringContaining('2026'));
    expect(when).toHaveTextContent(/ago$/);
  });
});
