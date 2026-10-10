import type { ReactNode } from 'react';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('./use-topology', () => ({ useTopology: () => state.value }));
vi.mock('./canvas', () => ({ CanvasView: () => <div data-testid="flow" /> }));
vi.mock('./inspector', () => ({ Inspector: () => null }));
vi.mock('./wizard/wizard', () => ({
  Wizard: ({
    step,
    mode,
    onLaunched,
  }: {
    step: string;
    mode: string;
    onLaunched: (s: { slug: string; source: 'cli' }) => void;
  }) => (
    <p>
      wizard {mode} {step}
      <button type="button" onClick={() => onLaunched({ slug: 'api', source: 'cli' })}>
        launch
      </button>
    </p>
  ),
}));
vi.mock('./launch-tracker', () => ({
  LaunchTracker: ({ seed }: { seed: { slug: string } }) => <p>tracking {seed.slug}</p>,
}));
vi.mock('@/lib/api/create-and-deploy', () => ({
  useCreateAndDeploy: () => ({ createApp: vi.fn(), deployGit: vi.fn() }),
}));
vi.mock('@/lib/api/queries', () => ({ keys: { apps: ['apps'] }, useApps: () => ({ data: [] }) }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

const { default: CanvasPage } = await import('./canvas-page');
const empty = { nodes: [], edges: [], issues: [] };
const render = (ui: ReactNode) =>
  rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => sessionStorage.clear());

describe('CanvasPage', () => {
  it('holds the space while loading', () => {
    state.value = { phase: 'loading', topology: empty, retry: vi.fn() };
    render(<CanvasPage />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('opens the wizard front door on an empty account', () => {
    state.value = { phase: 'empty', topology: empty, retry: vi.fn() };
    render(<CanvasPage />);
    expect(screen.getByText('wizard empty start')).toBeInTheDocument();
  });

  it('separates unreachable from a failed read', () => {
    state.value = { phase: 'unreachable', topology: empty, retry: vi.fn() };
    const { unmount } = render(<CanvasPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    unmount();
    state.value = {
      phase: 'error',
      error: new ApiError({ status: 500, code: 'internal', title: 'boom' }),
      topology: empty,
      retry: vi.fn(),
    };
    render(<CanvasPage />);
    expect(screen.getByText(/boom/i)).toBeInTheDocument();
  });

  it('draws the flow when ready', () => {
    state.value = {
      phase: 'ready',
      topology: empty,
      retry: vi.fn(),
      retryApp: vi.fn(),
      settled: true,
    };
    render(<CanvasPage />);
    expect(screen.getByTestId('flow')).toBeInTheDocument();
  });

  it('says what it could not draw and offers a retry', () => {
    const retry = vi.fn();
    state.value = {
      phase: 'ready',
      topology: { ...empty, issues: [{ kind: 'read_failed', ref: 'postgres', detail: '' }] },
      retry,
    };
    render(<CanvasPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t load Postgres.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalled();
  });
  it('shows load gaps as one bar with a retry', () => {
    const retry = vi.fn();
    state.value = {
      phase: 'ready',
      topology: { ...empty, issues: [{ kind: 'read_failed', ref: 'postgres', detail: '' }] },
      retry,
      retryApp: vi.fn(),
      settled: true,
    };
    render(<CanvasPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t load Postgres.');
  });

  it('does not flash the front door back while a new app is still loading', () => {
    state.value = { phase: 'empty', topology: empty, retry: vi.fn() };
    render(<CanvasPage />);
    fireEvent.click(screen.getByRole('button', { name: 'launch' }));
    expect(screen.queryByText(/wizard empty/)).not.toBeInTheDocument();
  });

  it('a stored launch alone does not hold an empty account', () => {
    sessionStorage.setItem(
      'gregale.canvas.launches',
      JSON.stringify({ gone: { slug: 'gone', source: 'cli' } })
    );
    state.value = { phase: 'empty', topology: empty, retry: vi.fn() };
    render(<CanvasPage />);
    expect(screen.getByText(/wizard empty start/)).toBeInTheDocument();
  });

  it('picks a first deploy back up after a reload', () => {
    sessionStorage.setItem(
      'gregale.canvas.launches',
      JSON.stringify({ api: { slug: 'api', source: 'cli' }, gone: { slug: 'gone', source: 'cli' } })
    );
    state.value = {
      phase: 'ready',
      topology: {
        nodes: [
          {
            id: 'app:api',
            data: {
              kind: 'app',
              slug: 'api',
              phase: 'undeployed',
              metrics: 'ready',
              connections: 'ready',
            },
          },
        ],
        edges: [],
        issues: [],
      },
      retry: vi.fn(),
      retryApp: vi.fn(),
      settled: true,
    };
    render(<CanvasPage />);
    expect(screen.getByText('tracking api')).toBeInTheDocument();
    expect(screen.queryByText('tracking gone')).not.toBeInTheDocument();
  });
});
