import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { withRouter } from '@/test/router';
import type { RawWakeEvent } from '@/lib/wake-anatomy';
import {
  coldBootFrames,
  failedFrames,
  fallbackFrames,
  frame,
  restoreFrames,
  stalledFrames,
  thawFrames,
} from '@/test/wake-frames';
import { WakeWaterfall } from './wake-waterfall';

const { useWakeTimeline } = vi.hoisted(() => ({ useWakeTimeline: vi.fn() }));
vi.mock('@/lib/api/queries', () => ({ useWakeTimeline }));

const fetchNextPage = vi.fn();
function pages(list: RawWakeEvent[][], hasNextPage = false) {
  return {
    data: {
      pages: list.map((events) => ({
        wake_id: 'wk-1',
        app_id: 'app-1',
        events,
        next_cursor: '',
        limit: 1000,
      })),
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage: false,
  };
}
const show = (events: RawWakeEvent[]) => useWakeTimeline.mockReturnValue(pages([events]));
const summary = () => screen.getByRole('region', { name: 'Wake summary' });

beforeEach(() => {
  useWakeTimeline.mockReset();
  fetchNextPage.mockReset();
});

describe('WakeWaterfall', () => {
  it('leads with the total, the method, the outcome and where the time went', () => {
    show(restoreFrames());
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(within(summary()).getByText('311 ms')).toBeInTheDocument();
    expect(within(summary()).getByText('Restore')).toBeInTheDocument();
    expect(within(summary()).getByText('Ready')).toBeInTheDocument();
    expect(summary()).toHaveTextContent('Most of the restore: Load snapshot, 142 ms (47%).');
    expect(
      within(summary()).getByRole('button', { name: 'Copy: wake ID wk-1' })
    ).toBeInTheDocument();
  });

  it('lays milestones on a time axis and opens the breakdown under the ready row', async () => {
    show(restoreFrames());
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    const stages = screen.getByRole('table', { name: 'Stages' });
    for (const label of [
      'Until admitted',
      'Until boot started',
      'Until boot recorded',
      'Until first byte',
    ])
      expect(within(stages).getByText(label)).toBeInTheDocument();
    const host = within(stages).getByRole('button', { name: 'Until ready' });
    expect(host).toHaveAttribute('aria-expanded', 'true');
    const phases = screen.getByRole('table', { name: 'Restore phases, 302 ms total' });
    expect(within(phases).getByText('Load snapshot')).toBeInTheDocument();
    expect(within(phases).getByText('load_snapshot_ms')).toBeInTheDocument();
    expect(within(phases).getByText('Fetched')).toBeInTheDocument();
    expect(within(phases).getByText('Cache hit')).toBeInTheDocument();
    expect(within(phases).getByText('458 MiB')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Before restore (not in the total)' })).getByText(
        'Set up network'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Phases can overlap. Their durations add up to 263 ms against a total of 302 ms.'
      )
    ).toBeInTheDocument();
    await userEvent.click(host);
    expect(host).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('table', { name: 'Restore phases, 302 ms total' })
    ).not.toBeInTheDocument();
  });

  it('shows the gateway timings for the first byte', () => {
    show(restoreFrames());
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    const firstByte = screen.getByRole('region', { name: 'First byte' });
    expect(within(firstByte).getByText('wake_wait')).toBeInTheDocument();
    expect(within(firstByte).getByText('300 ms')).toBeInTheDocument();
  });

  it('says nothing about overlap when the phases add up to the total', () => {
    show(coldBootFrames);
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(
      screen.getByRole('table', { name: 'Cold boot phases, 872 ms total' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Phases can overlap/)).not.toBeInTheDocument();
  });

  it.each([
    [failedFrames, 'The boot failed (oom_killed).'],
    [stalledFrames, 'The wake stalled (watchdog_timeout).'],
    [
      fallbackFrames,
      'The restore fell back to a cold boot because the app’s after-restore callback failed (after_restore_failed).',
    ],
  ])('puts a failure, stall or fallback first', (frames, text) => {
    show(frames);
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(within(summary()).getByRole('status')).toHaveTextContent(text);
    expect(summary()).not.toHaveTextContent('Most of the');
  });

  it('offers a thaw picker only when the wake has more than one generation', async () => {
    show(thawFrames);
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    const picker = screen.getByRole('combobox', { name: 'Wake generation' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['First boot', 'Thaw 1', 'Thaw 2']);
    expect(within(summary()).getByText('Thaw')).toBeInTheDocument();
    await userEvent.selectOptions(picker, 'First boot');
    expect(within(summary()).getByText('Restore')).toBeInTheDocument();
  });

  it('has no picker for a single generation', () => {
    show(restoreFrames());
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(screen.queryByRole('combobox', { name: 'Wake generation' })).not.toBeInTheDocument();
  });

  it('keeps unknown frames under Other frames, opened when there are no stages', () => {
    show([frame(0, 'wake.queued', 'schedd'), frame(125, 'vm.ready', 'vmmd')]);
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    const other = screen.getByText('Other frames (2)').closest('details')!;
    expect(other).toHaveAttribute('open');
    expect(within(other).getByText('vm.ready')).toBeInTheDocument();
    expect(within(other).getByText('+125 ms')).toBeInTheDocument();
  });

  it('never prints NaN when a breakdown has no total', () => {
    show([frame(0, 'wake.restore_breakdown', 'vmmd', { load_snapshot_ms: 10 })]);
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phases can overlap/)).not.toBeInTheDocument();
  });

  it('counts a frame repeated across pages once and loads later frames on request', async () => {
    const boundary = frame(0, 'state_transition', 'schedd');
    useWakeTimeline.mockReturnValue(
      pages([[boundary], [boundary, frame(5, 'park_snapshot_error', 'schedd')]], true)
    );
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(screen.getByText('Other frames (2)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load later frames' }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it('shows the empty state for a wake with no frames', () => {
    show([]);
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(screen.getByText(/No frames recorded for this wake/)).toBeInTheDocument();
  });

  it('treats an unknown or expired wake (not_found) as empty, not as an error', () => {
    useWakeTimeline.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({
        status: 404,
        code: 'not_found',
        title: 'Wake not found',
        detail: 'no events row with that wake_id belongs to this account',
      }),
      refetch: vi.fn(),
      hasNextPage: false,
      fetchNextPage,
      isFetchingNextPage: false,
    });
    render(<WakeWaterfall slug="api" wakeId="wk-gone" />);
    expect(screen.getByText(/No frames recorded for this wake/)).toBeInTheDocument();
    expect(screen.queryByText(/no events row/)).not.toBeInTheDocument();
  });

  it('renders the Free-plan 402 as the plan panel', async () => {
    useWakeTimeline.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({
        status: 402,
        code: 'plan_per_app_metrics_not_allowed',
        title: 'Not on your plan',
        detail: 'the free plan does not include per-app metrics; upgrade to Hobby or above.',
      }),
      refetch: vi.fn(),
      hasNextPage: false,
      fetchNextPage,
      isFetchingNextPage: false,
    });
    render(withRouter(<WakeWaterfall slug="api" wakeId="wk-1" />));
    // withRouter mounts asynchronously; the plan panel carries the API's own words.
    expect(await screen.findByText(/does not include per-app metrics/i)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Stages' })).not.toBeInTheDocument();
  });
});
