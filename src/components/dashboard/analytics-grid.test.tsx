import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { AnalyticsGrid, chosenCards, type AnalyticsPoint } from './analytics-grid';

const points: AnalyticsPoint[] = [0, 1, 2, 3].map((hour) => ({
  start: `2026-11-03T0${hour}:00:00Z`,
  requests: (hour + 1) * 10,
  error_requests: hour,
  error_rate_pct: hour,
  cold_boots: 1,
  p50_ms: 20,
  p95_ms: 80,
  p99_ms: 120,
}));
function Board({ onInspect }: { onInspect?: (id: string) => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <AnalyticsGrid
      points={points}
      build={(ids) => chosenCards(ids, points, 'the first half')}
      picking={picking}
      onPicking={setPicking}
      onInspect={onInspect}
    />
  );
}
it('opens details by keyboard while keeping reordering and menus independent', async () => {
  const inspect = vi.fn();
  render(<Board onInspect={inspect} />);
  screen.getByRole('button', { name: 'View Requests details' }).focus();
  await userEvent.keyboard('{ArrowRight}');
  await userEvent.click(screen.getByRole('button', { name: 'Requests options' }));
  await userEvent.keyboard('{Escape}');
  expect(inspect).not.toHaveBeenCalled();
  screen.getByRole('button', { name: 'View Requests details' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(inspect).toHaveBeenCalledExactlyOnceWith('requests');
});
const order = () =>
  [...screen.getByRole('list', { name: 'Metric cards' }).querySelectorAll('[data-metric-id]')].map(
    (card) => card.getAttribute('data-metric-id')
  );
beforeEach(() => localStorage.clear());

it('moves cards by keyboard and retains their order after remounting', async () => {
  const view = render(<Board />);
  screen.getByRole('button', { name: 'Move Requests' }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(order().slice(0, 2)).toEqual(['errors', 'requests']);
  expect(screen.getByRole('status')).toHaveTextContent('Requests moved to position 2');
  view.unmount();
  render(<Board />);
  expect(order().slice(0, 2)).toEqual(['errors', 'requests']);
});

it('adds and removes metrics through the visible controls', async () => {
  render(<Board />);
  await userEvent.click(screen.getByRole('button', { name: 'Add a metric' }));
  await userEvent.click(screen.getByRole('button', { name: 'Latency p99' }));
  expect(order()).toContain('p99');
  await userEvent.click(screen.getByRole('button', { name: 'Latency p99 options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
  expect(order()).not.toContain('p99');
  expect(order()).toEqual(['requests', 'errors', 'error_rate', 'p95', 'cold_boots']);
});

it('retains a deliberately empty layout and can add a card back', async () => {
  localStorage.setItem('gregale.analytics.order', '[]');
  render(<Board />);
  expect(order()).toEqual([]);
  await userEvent.click(screen.getByRole('button', { name: 'Add a metric' }));
  await userEvent.click(screen.getByRole('button', { name: 'Requests' }));
  expect(order()).toEqual(['requests']);
});

it('continues editing the current layout when browser storage is unavailable', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  try {
    render(<Board />);
    for (const label of ['Requests', 'Errors']) {
      await userEvent.click(screen.getByRole('button', { name: `${label} options` }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    }
    expect(order()).toEqual(['error_rate', 'p95', 'cold_boots']);
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});

it('does not invent a growth percentage when the earlier half has no traffic', () => {
  const cards = chosenCards(
    ['requests'],
    points.map((p, i) => ({ ...p, requests: i < 2 ? 0 : 10 })),
    'the first half'
  );
  expect(cards[0].delta).toBeNull();
});

it('uses the latest hour with requests for an hourly latency card', () => {
  const cards = chosenCards(
    ['p95'],
    [...points, { ...points[0], requests: 0, p95_ms: 0 }],
    'the first half'
  );
  expect(cards[0].value).toBe('80 ms');
  expect(cards[0].caption).toBe('Latest hour with requests');
});
