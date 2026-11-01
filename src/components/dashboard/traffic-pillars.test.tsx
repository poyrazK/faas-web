import { Profiler } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TrafficPillars } from './traffic-pillars';
import { COLS, ROWS, VIEW_W, type HourPoint } from './traffic-pillars-geometry';

const hours: HourPoint[] = Array.from({ length: COLS }, (_, i) => ({
  requests: 100 + i,
  error_requests: i === 20 ? 3 : 0,
  error_rate_pct: i === 20 ? 2.5 : 0,
  cold_boots: 0,
  p95_ms: 50 + i,
}));
const SUMMARY = '2.9K requests · 0.10% errors · p95 60 ms (2xx)';

function field() {
  return screen.getByRole('group', { name: /requests per hour/i });
}
function readout() {
  return screen.getByRole('status');
}

describe('TrafficPillars', () => {
  it('draws a decorative field of batched rows and reads the totals at rest', () => {
    const { container } = render(<TrafficPillars points={hours} summary={SUMMARY} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelectorAll('g')).toHaveLength(ROWS);
    expect(svg.querySelectorAll('path')).toHaveLength(ROWS * 4);
    expect(readout()).toHaveTextContent(SUMMARY);
  });

  it('inks only with theme tokens', () => {
    const { container } = render(<TrafficPillars points={hours} summary={SUMMARY} />);
    for (const path of container.querySelectorAll('path')) {
      expect(path.getAttribute('fill')).toMatch(/^var\(--(brand|card|status-critical)\)$/);
      expect(path.getAttribute('stroke') ?? 'none').toMatch(/^(none|var\(--brand\))$/);
    }
  });

  it('reads each hour from the keyboard and returns to the totals on blur', async () => {
    const user = userEvent.setup();
    render(<TrafficPillars points={hours} summary={SUMMARY} />);
    await user.tab();
    expect(field()).toHaveFocus();
    await user.keyboard('{End}');
    expect(readout()).toHaveTextContent('This hour · 123 requests · no errors · p95 73ms');
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(readout()).toHaveTextContent('3h ago · 120 requests · 2.50% errors · p95 70ms');
    await user.keyboard('{Home}');
    expect(readout()).toHaveTextContent('23h ago · 100 requests');
    await user.keyboard('{ArrowLeft}');
    expect(readout()).toHaveTextContent('23h ago · 100 requests');
    await user.tab();
    expect(readout()).toHaveTextContent(SUMMARY);
  });

  it('reads the hour under the pointer and lets go when it leaves', () => {
    render(<TrafficPillars points={hours} summary={SUMMARY} />);
    vi.spyOn(field(), 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: VIEW_W,
      height: 192,
      right: VIEW_W,
      bottom: 192,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerMove(field(), { clientX: VIEW_W });
    expect(readout()).toHaveTextContent('This hour');
    fireEvent.pointerMove(field(), { clientX: 0 });
    expect(readout()).toHaveTextContent('23h ago');
    fireEvent.pointerLeave(field());
    expect(readout()).toHaveTextContent(SUMMARY);
  });

  it('lifts the field under the pointer without a React commit within an hour', async () => {
    let commits = 0;
    const { container } = render(
      <Profiler id="pillars" onRender={() => (commits += 1)}>
        <TrafficPillars points={hours} summary={SUMMARY} />
      </Profiler>
    );
    vi.spyOn(field(), 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: VIEW_W,
      height: 192,
      right: VIEW_W,
      bottom: 192,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const rest = [...container.querySelectorAll('path')].map((p) => p.getAttribute('d'));
    fireEvent.pointerMove(field(), { clientX: VIEW_W / 2 });
    await act(async () => {});
    const settled = commits;
    // Small moves inside the same hour glide the lift without re-rendering.
    for (let i = 1; i <= 5; i++) fireEvent.pointerMove(field(), { clientX: VIEW_W / 2 - i });
    await waitFor(() =>
      expect([...container.querySelectorAll('path')].map((p) => p.getAttribute('d'))).not.toEqual(
        rest
      )
    );
    expect(commits).toBe(settled);
  });

  it('marks hours the series does not cover as not recorded', async () => {
    const user = userEvent.setup();
    render(<TrafficPillars points={hours.slice(-2)} summary={SUMMARY} />);
    await user.tab();
    await user.keyboard('{Home}');
    expect(readout()).toHaveTextContent('23h ago · not recorded');
  });
});
