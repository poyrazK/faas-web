import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Skeleton } from './skeleton';
import { ShimmerText } from './shimmer';
import { InlinePhase, LoadingState } from '@/components/dashboard/primitives';
import { RoutePending } from '@/components/route-status';

/** No loading state spins any more: content shimmers, work in progress shimmers its label. */
const spinners = (root: HTMLElement) => root.querySelectorAll('.animate-spin');

describe('shimmer loading', () => {
  it('a skeleton shimmers instead of pulsing', () => {
    const { container } = render(<Skeleton className="h-3" />);
    const bar = container.firstElementChild!;
    expect(bar).toHaveClass('shimmer');
    expect(bar).not.toHaveClass('motion-safe:animate-pulse');
  });

  it('a loading page shows shimmering lines and keeps its message for screen readers', () => {
    const { container } = render(<LoadingState message="Loading usage…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading usage…');
    expect(screen.getByText('Loading usage…')).toHaveClass('sr-only');
    expect(status.querySelectorAll('.shimmer').length).toBeGreaterThanOrEqual(3);
    expect(spinners(container)).toHaveLength(0);
  });

  it('an inline loading line shimmers and stays valid inside a paragraph', () => {
    const { container } = render(
      <p>
        <InlinePhase phase="loading" loadingMessage="Reading egress…" />
      </p>
    );
    const status = screen.getByRole('status');
    expect(status.tagName).toBe('SPAN');
    expect(status).toHaveTextContent('Reading egress…');
    expect(status.querySelectorAll('.shimmer').length).toBeGreaterThanOrEqual(1);
    expect(spinners(container)).toHaveLength(0);
  });

  it('the page loader is a shimmering page, not dots', () => {
    const { container } = render(<RoutePending />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(container.querySelectorAll('.shimmer').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('.route-pending-dot')).toBeNull();
  });

  it('a busy button shimmers its own label instead of spinning', () => {
    const { container } = render(<Button busy>Save</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    expect(button.querySelector('.shimmer-text')).toHaveTextContent('Save');
    expect(button).toHaveAccessibleName('Working…');
    expect(spinners(container)).toHaveLength(0);
  });

  it('ShimmerText shimmers a label', () => {
    render(<ShimmerText>Deploying</ShimmerText>);
    expect(screen.getByText('Deploying')).toHaveClass('shimmer-text');
  });
});

describe('capability gate while checking', () => {
  it('shimmers instead of printing "Checking availability…"', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    vi.doMock('@/lib/api/capabilities', () => ({
      useCapabilityAccess: () => ({ access: 'loading', refresh: () => {} }),
    }));
    const { CapabilityGate } = await import('@/components/dashboard/capability-gate');
    render(
      <CapabilityGate capability="budgets" title="Budgets">
        <p>Budgets</p>
      </CapabilityGate>
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Checking availability…');
    expect(status.querySelector('.shimmer')).not.toBeNull();
    vi.doUnmock('@/lib/api/capabilities');
  });
});
