import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('./use-topology', () => ({ useTopology: () => state.value }));
vi.mock('./canvas', () => ({ CanvasView: () => <div data-testid="flow" /> }));
vi.mock('./inspector', () => ({ Inspector: () => null }));
vi.mock('./wizard/wizard', () => ({
  Wizard: ({ step, mode }: { step: string; mode: string }) => (
    <p>
      wizard {mode} {step}
    </p>
  ),
}));
vi.mock('@/lib/api/queries', () => ({ useApps: () => ({ data: [] }) }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

const { default: CanvasPage } = await import('./canvas-page');
const empty = { nodes: [], edges: [], issues: [] };

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
});
