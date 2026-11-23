import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { DailyUsagePanel } from './usage-daily';

const now = Date.parse('2026-11-04T09:00:00Z');
const daily = [
  { date: '2026-11-01', gb_hours: 0.1 },
  { date: '2026-11-02', gb_hours: 0.2, top_app_slug: 'api', top_app_gb_hours: 0.15 },
  { date: '2026-11-04', gb_hours: 0.9, top_app_slug: 'engine', top_app_gb_hours: 0.66 },
];

function show() {
  render(
    <DailyUsagePanel
      daily={daily}
      month="2026-11"
      usedGbHours={1.2}
      includedGbHours={10}
      now={now}
    />
  );
}

it('reads a day on hover: its hours, the app behind them, and where the month stood', () => {
  show();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.pointerEnter(screen.getByRole('img', { name: 'Nov 4: 0.9 GB-h' }));
  const readout = screen.getByRole('status');
  expect(readout).toHaveTextContent('Wed, Nov 4 · today so far');
  expect(readout).toHaveTextContent('0.9 GB-hours');
  expect(readout).toHaveTextContent('Mostly engine, 73% of the day');
  // Today is still running, so it isn't compared with a whole day.
  expect(readout).not.toHaveTextContent('usual day');
  expect(readout).toHaveTextContent('Month so far: 1.2 GB-h · 12% of your allowance');
  fireEvent.pointerLeave(screen.getByRole('group', { name: /Days of the month/ }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('reads days with the arrow keys and says when a day has no rollup', async () => {
  show();
  screen.getByRole('group', { name: /Days of the month/ }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('status')).toHaveTextContent('Sun, Nov 1');
  await userEvent.keyboard('{ArrowRight}{ArrowRight}');
  expect(screen.getByRole('status')).toHaveTextContent('Tue, Nov 3');
  expect(screen.getByRole('status')).toHaveTextContent('No rollup for this day yet.');
  await userEvent.keyboard('{End}');
  expect(screen.getByRole('status')).toHaveTextContent('Wed, Nov 4');
});
