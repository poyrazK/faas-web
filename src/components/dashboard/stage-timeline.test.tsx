import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StageTimeline, STAGES } from './stage-timeline';

/**
 * The pipeline as the server recorded it: every stage in order, a duration
 * for the ones that ran, the reason for the one that failed, and the one
 * running now marked as the current step.
 */
describe('StageTimeline', () => {
  it('shows all six stages in order, marking done, failed, current and not-yet', () => {
    render(
      <StageTimeline
        stages={{
          current: 'image_build',
          current_started_at: '2026-08-31T10:00:00Z',
          history: [
            { name: 'source_download', status: 'completed', duration_ms: 1200 },
            {
              name: 'dependency_restore',
              status: 'failed',
              duration_ms: 8000,
              reason: 'npm ERR! 404',
            },
          ],
        }}
      />
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(STAGES.length);
    expect(items[0]).toHaveTextContent('Source download');
    expect(items[0]).toHaveTextContent('1.2 s');
    expect(items[1]).toHaveTextContent('npm ERR! 404');
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[5]).toHaveTextContent('Readiness');
  });
});
