import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    search,
  }: {
    children: ReactNode;
    params: { appSlug: string };
    search: { tab: string };
  }) => <a href={`/dashboard/apps/${params.appSlug}?tab=${search.tab}`}>{children}</a>,
}));

const { BindingsGateNotice, bindingBlockerRemedy, bindingsGateRefusal } =
  await import('./bindings-gate');

const DEPLOYMENT = 'd2c4e6f8-0000-4000-8000-000000000001';

function bindingsProblem(
  code: string,
  blockers: { code: string; binding?: string; message: string }[] = []
) {
  return new ApiError({
    status: 409,
    code,
    title: code,
    detail: 'Resolve the binding check blockers and verify this deployment before promoting.',
    ...(code === 'bindings_release_required'
      ? {
          hint: 'Verify the exact deployment receiving traffic, then promote, advance its canary, or abort.',
        }
      : {
          bindings_check: {
            app: 'alpha',
            scope: 'default',
            deployment_id: DEPLOYMENT,
            checked_at: '2026-11-03T10:00:00Z',
            inventory_generated_at: '2026-11-03T10:00:00Z',
            max_verification_age: '10m0s',
            allow_unsupported: false,
            passed: false,
            coverage: 'partial',
            bindings: [],
            runtime: [],
            issues: [],
            blockers,
            warnings: [],
          },
        }),
  });
}

describe('bindingsGateRefusal', () => {
  it('reads the blockers of a failed or changed check', () => {
    const failed = bindingsGateRefusal(
      bindingsProblem('bindings_check_failed', [{ code: 'verification_expired', message: 'm' }])
    );
    expect(failed).toMatchObject({
      code: 'bindings_check_failed',
      blockers: [{ code: 'verification_expired' }],
    });
    expect(bindingsGateRefusal(bindingsProblem('bindings_check_changed'))?.code).toBe(
      'bindings_check_changed'
    );
  });

  it('reads an enforced policy with no report as a refusal with no blockers', () => {
    expect(bindingsGateRefusal(bindingsProblem('bindings_release_required'))).toMatchObject({
      code: 'bindings_release_required',
      blockers: [],
    });
  });

  it('is null for anything else', () => {
    expect(bindingsGateRefusal(new ApiError({ status: 409, code: 'conflict', title: 'x' }))).toBe(
      null
    );
    expect(bindingsGateRefusal(new Error('x'))).toBe(null);
  });
});

describe('bindingBlockerRemedy', () => {
  it.each([
    ['verification_expired', /verify this release/i],
    ['verification_unknown', /verify this release/i],
    ['service_target_unverified', /verify this release/i],
    ['verification_failed', /last probe .* failed/i],
    ['verification_unsupported', /no supported probe/i],
    ['queue_consumer_stale', /30-second window/i],
    ['queue_consumer_paused', /resume it/i],
    ['queue_consumer_unobserved', /healthy poll/i],
    ['queue_completion_unverified', /queue canary/i],
    ['application_ack_missing', /current secret version/i],
    ['reload_stale', /current secret version/i],
    ['runtime_updating', /starting/i],
    ['object_storage_permission_insufficient', /object-storage canary/i],
    ['binding_not_ready', /provisioning/i],
    ['promotion_observations_changed', /retry/i],
    ['something_new', /resolve this blocker/i],
  ])('tells what to do about %s', (code, pattern) => {
    expect(bindingBlockerRemedy(code)).toMatch(pattern);
  });
});

describe('BindingsGateNotice', () => {
  it('lists each blocker with its binding, message and what to do, and how to verify', () => {
    const refusal = bindingsGateRefusal(
      bindingsProblem('bindings_check_failed', [
        {
          code: 'verification_expired',
          binding: 'BILLING_URL',
          message: 'Binding verification expired.',
        },
        { code: 'queue_consumer_stale', binding: 'orders', message: 'The consumer is stale.' },
      ])
    )!;
    render(
      <BindingsGateNotice
        refusal={refusal}
        slug="alpha"
        deploymentId={DEPLOYMENT}
        action="traffic change"
      />
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/bindings check failed\. traffic is unchanged/i);
    const items = within(screen.getByRole('list', { name: /binding blockers/i })).getAllByRole(
      'listitem'
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('BILLING_URL');
    expect(items[0]).toHaveTextContent(/verify this release/i);
    expect(items[1]).toHaveTextContent(/30-second window/i);
    expect(
      screen.getByRole('link', { name: /verify bindings on the services tab/i })
    ).toHaveAttribute('href', '/dashboard/apps/alpha?tab=Services');
    expect(
      screen.getByText(`gregale app binding verify alpha --release ${DEPLOYMENT} --all`)
    ).toBeInTheDocument();
  });

  it('says a recovery cannot raise traffic under an enforced policy, with the API hint', () => {
    render(
      <BindingsGateNotice
        refusal={bindingsGateRefusal(bindingsProblem('bindings_release_required'))!}
        slug="alpha"
        deploymentId={DEPLOYMENT}
        action="rollout recovery"
      />
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/binding release policy blocked traffic/i);
    expect(alert).toHaveTextContent(/rollout recovery does not run the bindings check/i);
    expect(alert).toHaveTextContent(/advance its canary, or abort/i);
    expect(screen.queryByRole('list', { name: /binding blockers/i })).toBeNull();
  });
});
