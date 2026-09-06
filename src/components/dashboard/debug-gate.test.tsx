import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { DebugGate, isPlanGated } from './debug-gate';

const gated = new ApiError({
  status: 402,
  code: 'plan_feature_gated',
  title: "Plan doesn't include this feature",
  detail: "the free plan doesn't unlock debugger; upgrade to Hobby or higher.",
});

describe('isPlanGated', () => {
  it('recognises the plan gate by code, not by status', () => {
    expect(isPlanGated(gated)).toBe(true);
    // 402 is also billing_past_due, which is a different situation entirely.
    expect(
      isPlanGated(new ApiError({ status: 402, code: 'billing_past_due', title: 'Suspended' }))
    ).toBe(false);
    expect(isPlanGated(new ApiError({ status: 500, code: 'internal', title: 'Boom' }))).toBe(false);
    expect(isPlanGated(undefined)).toBe(false);
  });
});

describe('DebugGate', () => {
  it('explains the plan rather than showing an error', () => {
    render(
      <DebugGate error={gated}>
        <p>telemetry</p>
      </DebugGate>
    );
    expect(screen.getByText(/doesn't unlock debugger/i)).toBeInTheDocument();
    expect(screen.queryByText('telemetry')).not.toBeInTheDocument();
  });

  it('passes the API its own words, which name the upgrade', () => {
    render(
      <DebugGate error={gated}>
        <p>telemetry</p>
      </DebugGate>
    );
    expect(screen.getByText(/upgrade to Hobby/i)).toBeInTheDocument();
  });

  it('renders the page when there is no gate', () => {
    render(
      <DebugGate error={null}>
        <p>telemetry</p>
      </DebugGate>
    );
    expect(screen.getByText('telemetry')).toBeInTheDocument();
  });

  it('leaves a real failure to the normal error path', () => {
    render(
      <DebugGate error={new ApiError({ status: 500, code: 'internal', title: 'Boom' })}>
        <p>telemetry</p>
      </DebugGate>
    );
    // Not the gate's business — the sections render and show their own error.
    expect(screen.getByText('telemetry')).toBeInTheDocument();
  });
});
