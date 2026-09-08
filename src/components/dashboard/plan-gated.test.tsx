import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';
import { PlanGated, isPlanGate } from './plan-gated';

const gated = new ApiError({
  status: 402,
  code: 'jobs_not_allowed',
  title: 'Jobs unavailable on this plan',
  detail: 'the free plan does not include jobs; upgrade to Hobby or above.',
});

describe('isPlanGate', () => {
  it('matches a plan gate by code, never by status', () => {
    expect(isPlanGate(gated)).toBe(true);
    // Same 402, different situation: an unpaid invoice, not a tier.
    expect(
      isPlanGate(new ApiError({ status: 402, code: 'billing_past_due', title: 'Suspended' }))
    ).toBe(false);
    expect(isPlanGate(new ApiError({ status: 500, code: 'internal', title: 'Boom' }))).toBe(false);
    expect(isPlanGate(null)).toBe(false);
  });

  it('covers the other plan-gate codes the API uses', () => {
    for (const code of [
      'plan_feature_gated',
      'plan_alert_rules_not_allowed',
      'plan_mirror_not_allowed',
      'tenant_surfaces_not_allowed',
      'openapi_docs_not_allowed',
      'plan_per_app_metrics_not_allowed',
      'plan_app_usage_summary_not_allowed',
      'plan_static_egress_ip_not_allowed',
      'plan_cors_preset_not_allowed',
      'managed_postgres_not_in_plan',
      'triggers_not_allowed',
    ]) {
      expect(isPlanGate(new ApiError({ status: 402, code, title: 'Gated' }))).toBe(true);
    }
  });
});

describe('PlanGated', () => {
  it('shows the API its own words instead of an error', async () => {
    render(
      withRouter(
        <PlanGated error={gated} feature="Jobs">
          <p>the page</p>
        </PlanGated>
      )
    );
    expect(await screen.findByText(/does not include jobs/i)).toBeInTheDocument();
    expect(screen.queryByText('the page')).not.toBeInTheDocument();
  });

  it('renders the page when there is no gate', async () => {
    render(
      withRouter(
        <PlanGated error={null} feature="Jobs">
          <p>the page</p>
        </PlanGated>
      )
    );
    expect(await screen.findByText('the page')).toBeInTheDocument();
  });

  it('leaves a real failure to the section that hit it', async () => {
    render(
      withRouter(
        <PlanGated
          error={new ApiError({ status: 500, code: 'internal', title: 'Boom' })}
          feature="Jobs"
        >
          <p>the page</p>
        </PlanGated>
      )
    );
    expect(await screen.findByText('the page')).toBeInTheDocument();
  });
});
