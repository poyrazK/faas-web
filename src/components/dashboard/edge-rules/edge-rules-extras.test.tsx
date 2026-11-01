import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EdgeRule } from '@/lib/api/queries';

const state = vi.hoisted(() => ({
  off: new Set<string>(),
  follow: vi.fn(),
}));
vi.mock('@/components/dashboard/capability-gate', () => ({
  CapabilityGate: ({
    capability,
    title,
    children,
  }: {
    capability: string;
    title: string;
    children: ReactNode;
  }) => (state.off.has(capability) ? <p>{title} is off</p> : <>{children}</>),
}));
vi.mock('@/lib/api/edge-rules', () => ({ useEdgeRuleSetFollower: state.follow }));
vi.mock('./edge-rule-versions', () => ({ EdgeRuleVersions: () => <p>versions</p> }));
vi.mock('./edge-rule-suggestions', () => ({ EdgeRuleSuggestions: () => <p>suggestions</p> }));
vi.mock('./edge-waf-review', () => ({ EdgeWAFReview: () => <p>waf review</p> }));
vi.mock('./edge-rule-lists', () => ({ EdgeRuleLists: () => <p>lists</p> }));

const { EdgeRulesExtras } = await import('./edge-rules-extras');

const rule = (id: string, kind: EdgeRule['kind'], updated = '2026-10-01T00:00:00Z') =>
  ({ id, kind, updated_at: updated }) as EdgeRule;

beforeEach(() => {
  state.off = new Set();
  state.follow.mockReset();
});

describe('EdgeRulesExtras', () => {
  it('shows versions, suggestions and lists on an app; the WAF review only with a waf rule', () => {
    const view = render(<EdgeRulesExtras slug="api" rules={[rule('a', 'ip')]} />);
    expect(screen.getByText('versions')).toBeInTheDocument();
    expect(screen.getByText('suggestions')).toBeInTheDocument();
    expect(screen.getByText('lists')).toBeInTheDocument();
    expect(screen.queryByText('waf review')).toBeNull();
    view.rerender(<EdgeRulesExtras slug="api" rules={[rule('a', 'ip'), rule('w', 'waf')]} />);
    expect(screen.getByText('waf review')).toBeInTheDocument();
  });

  it('follows the rule set by id and update time', () => {
    render(<EdgeRulesExtras slug="api" rules={[rule('b', 'ip', 't2'), rule('a', 'ip', 't1')]} />);
    expect(state.follow).toHaveBeenCalledWith('api', 'a@t1,b@t2');
  });

  it('shows only lists account-wide, where there is no one app', () => {
    render(<EdgeRulesExtras rules={[rule('w', 'waf')]} />);
    expect(screen.getByText('lists')).toBeInTheDocument();
    expect(screen.queryByText('versions')).toBeNull();
    expect(screen.queryByText('waf review')).toBeNull();
  });

  it('gates each part on its own capability', () => {
    state.off = new Set(['edge-rule-history', 'edge-rule-lists']);
    render(<EdgeRulesExtras slug="api" rules={[]} />);
    expect(screen.getByText('Versions is off')).toBeInTheDocument();
    expect(screen.getByText('Rule lists is off')).toBeInTheDocument();
    expect(screen.getByText('suggestions')).toBeInTheDocument();
  });
});
