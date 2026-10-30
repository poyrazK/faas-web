import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
vi.mock('@/components/dashboard/org-billing', () => ({
  OrgPlanSummary: ({ label }: { label: string }) => <p>org plan for {label}</p>,
}));
vi.mock('@/components/dashboard/spend-cap', () => ({ SpendCap: () => null }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { plan: 'hobby' }, refreshAccount: vi.fn() }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/lib/api/queries', () => ({
  useChangePlan: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBillingPortal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelBilling: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRetryBilling: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { Route } = await import('./dashboard.plans');
const PlansPage = (Route as unknown as { component: React.ComponentType }).component;

afterEach(() => {
  workspace.org = null;
  workspace.label = 'Personal';
});

describe('Plans in a company workspace', () => {
  it("shows the organization's plan and offers no personal plan switch", () => {
    workspace.org = 'acme';
    workspace.label = 'Acme';
    render(<PlansPage />);
    expect(screen.getByText('org plan for Acme')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Switch to/ })).toBeNull();
  });
  it('keeps the personal plans in the personal workspace', () => {
    render(<PlansPage />);
    expect(screen.queryByText(/org plan for/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Switch to/ }).length).toBeGreaterThan(0);
  });
});
