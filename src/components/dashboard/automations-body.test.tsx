import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AutomationsBody } from './automations-body';

const state = vi.hoisted(() => ({
  apps: [{ id: 'app-1', slug: 'alpha' }],
  read: vi.fn(),
  runtime: false,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account-1' } }) }));
vi.mock('@/lib/api/queries', () => ({
  useApps: () => ({ data: state.apps, isPending: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('./automation-editor', () => ({
  AutomationEditor: () => <div>Draft editor</div>,
  JsonReadout: () => null,
  JsonField: () => null,
}));
vi.mock('./automation-runs', () => ({ AutomationRuns: () => null }));
vi.mock('@/lib/api/automations', () => ({
  useAutomations: (...args: unknown[]) => {
    state.read(...args);
    const definition = {
      name: 'orders',
      steps: [{ name: 'process', path: '/process' }],
      trigger: { type: 'event', source: 'orders', event_type: '*' },
    };
    return {
      data: {
        runtime_enabled: state.runtime,
        unavailable_reason: state.runtime ? undefined : 'runtime_disabled',
        max_definitions: 10,
        automations: [
          {
            name: 'orders',
            draft: definition,
            published: definition,
            published_version: 2,
            version: 3,
            source: 'dashboard',
            enabled: true,
          },
        ],
      },
      isPending: false,
      error: null,
    };
  },
  useAutomationHealth: () => ({
    data: {
      run_count: 0,
      completed_run_count: 0,
      success_rate: 0,
      active_run_count: 0,
      queued_run_count: 0,
      failed_steps: [],
    },
    isPending: false,
    error: null,
  }),
  useWriteAutomation: () => ({ isPending: false }),
}));
beforeEach(() => {
  state.apps = [{ id: 'app-1', slug: 'alpha' }];
  state.runtime = false;
  state.read.mockClear();
});
it('keeps authoring discoverable while runtime execution is disabled', () => {
  render(<AutomationsBody search={{ app: 'alpha', automation: 'orders' }} onSelection={vi.fn()} />);
  expect(screen.getByText(/execution is not enabled/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'New automation' })).toBeEnabled();
  expect(screen.getByText('Draft editor')).toBeInTheDocument();
  expect(state.read).toHaveBeenCalledWith('account-1', 'alpha');
});
it('does not fetch a remembered fallback app for an inaccessible app link', () => {
  render(<AutomationsBody search={{ app: 'missing' }} onSelection={vi.fn()} />);
  expect(screen.getByText(/not in your accessible app list/)).toBeInTheDocument();
  expect(state.read).not.toHaveBeenCalled();
});
it('shows an empty app scope without starting disabled automation queries', () => {
  state.apps = [];
  render(<AutomationsBody search={{}} onSelection={vi.fn()} />);
  expect(screen.getByText(/workspace has none yet/)).toBeInTheDocument();
  expect(state.read).not.toHaveBeenCalled();
  expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
});
