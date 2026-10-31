import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Deployment } from '@/lib/api/queries';
import { DeploymentRolloutState, ROLLOUT_RULES } from './deployment-rollout-state';
import type { RolloutDecision } from '@/lib/api/deployment-detail';

const base: Deployment = {
  id: 'dep-1',
  app_id: 'app-1',
  image_digest: 'sha256:1',
  kind: 'github',
  status: 'live',
  created_at: '2026-10-31T10:00:00Z',
};

const decision = (overrides: Partial<RolloutDecision>): RolloutDecision => ({
  kind: 'advance',
  rule: 'advance_healthy',
  step: 1,
  traffic_percent: 10,
  decided_at: '2026-10-31T10:05:00Z',
  ...overrides,
});

describe('DeploymentRolloutState', () => {
  it('renders nothing when the API returned none of the fields', () => {
    const { container } = render(<DeploymentRolloutState deployment={base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains a release that waits for its scheduled start', () => {
    render(
      <DeploymentRolloutState
        deployment={{
          ...base,
          scheduled_release: {
            id: 's1',
            app: 'alpha',
            deployment_id: 'dep-1',
            release_at: '2026-11-01T02:00:00Z',
            state: 'scheduled',
            notify_channels: [],
            scheduled_by: 'design@gregale.dev',
            created_at: '2026-10-31T10:00:00Z',
            updated_at: '2026-10-31T10:00:00Z',
          },
        }}
      />
    );
    const region = screen.getByRole('region', { name: 'Rollout state' });
    expect(region).toHaveTextContent(/waits live without traffic/i);
    expect(region).toHaveTextContent('2026-11-01');
  });

  it('says why a schedule ended without starting', () => {
    render(
      <DeploymentRolloutState
        deployment={{
          ...base,
          scheduled_release: {
            id: 's1',
            app: 'alpha',
            deployment_id: 'dep-1',
            release_at: '2026-11-01T02:00:00Z',
            state: 'blocked',
            outcome_code: 'release_frozen',
            outcome_detail: 'A freeze was active at 02:00.',
            notify_channels: [],
            scheduled_by: 'design@gregale.dev',
            created_at: '2026-10-31T10:00:00Z',
            updated_at: '2026-10-31T10:00:00Z',
          },
        }}
      />
    );
    expect(screen.getByText(/A freeze was active at 02:00/)).toBeInTheDocument();
    expect(screen.getByText(/stays built without traffic/i)).toBeInTheDocument();
  });

  it('explains the current hold and the latest decision with both sides’ numbers', () => {
    render(
      <DeploymentRolloutState
        deployment={{
          ...base,
          rollout_state: 'rolling_out',
          rollout_hold: decision({
            kind: 'hold',
            rule: 'hold_insufficient_samples',
            summary: 'this release 3 requests, the current one 41 (20 each needed)',
            traffic_percent: 1,
            step: 0,
          }),
          rollout_decision: decision({
            kind: 'abort',
            rule: 'abort_5xx',
            candidate: { requests: 120, server_errors: 30 },
            stable: { requests: 900, server_errors: 2 },
            gates: [
              {
                name: 'checkout-slo',
                kind: 'slo',
                passed: false,
                observed: 12,
                bound: 10,
                samples: 400,
                summary: 'burned the checkout SLO 12x',
              },
            ],
          }),
        }}
      />
    );
    const region = screen.getByRole('region', { name: 'Rollout state' });
    expect(region).toHaveTextContent(ROLLOUT_RULES.hold_insufficient_samples);
    expect(region).toHaveTextContent('20 each needed');
    expect(region).toHaveTextContent(ROLLOUT_RULES.abort_5xx);
    expect(region).toHaveTextContent('30 of 120');
    expect(region).toHaveTextContent('2 of 900');
    expect(region).toHaveTextContent('checkout-slo');
    expect(region).toHaveTextContent(/failed/i);
  });

  it('does not show a stale hold once the rollout is no longer in flight', () => {
    render(
      <DeploymentRolloutState
        deployment={{
          ...base,
          rollout_state: 'complete',
          rollout_hold: decision({ kind: 'hold', rule: 'hold_signal_unavailable' }),
        }}
      />
    );
    expect(screen.queryByText(ROLLOUT_RULES.hold_signal_unavailable)).not.toBeInTheDocument();
  });

  it('explains a cron activation that has not finished', () => {
    render(
      <DeploymentRolloutState
        deployment={{
          ...base,
          configuration: {
            complete: false,
            crons: {
              status: 'pending',
              reason: 'awaiting_full_traffic',
              message: 'Cron schedules switch once this release serves all traffic.',
              hint: 'This finishes on its own.',
            },
          },
        }}
      />
    );
    expect(
      screen.getByText(/Cron schedules switch once this release serves all traffic/)
    ).toBeInTheDocument();
    expect(screen.getByText(/finishes on its own/)).toBeInTheDocument();
  });

  it('stays quiet about crons the release does not manage', () => {
    const { container } = render(
      <DeploymentRolloutState
        deployment={{
          ...base,
          configuration: { complete: true, crons: { status: 'not_managed', message: 'n/a' } },
        }}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('has a plain sentence for every rule the API can send', () => {
    for (const sentence of Object.values(ROLLOUT_RULES)) expect(sentence).toMatch(/^[A-Z]/);
  });
});
