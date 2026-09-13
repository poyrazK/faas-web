import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FailurePanel } from './failure-panel';
import type { FailureSummary } from './failure-summary';

const summary: FailureSummary = {
  cause: 'The app could not start.',
  nextStep: 'Check the command.',
  code: 'start_failed',
  evidence: [1, 2, 3, 4, 5].map((n) => ({ message: `Evidence ${n}` })),
};
describe('FailurePanel', () => {
  it('shows three excerpts, discloses the rest, and keeps technical codes secondary', async () => {
    render(<FailurePanel summary={summary} onViewOutput={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Failure explanation' })).toHaveTextContent(
      summary.cause
    );
    expect(screen.getByText('Evidence 3')).toBeVisible();
    expect(screen.getByText('Evidence 4')).not.toBeVisible();
    await userEvent.click(screen.getByText('Show 2 more excerpts'));
    expect(screen.getByText('Evidence 5')).toBeVisible();
    expect(screen.getByText('start_failed')).not.toBeVisible();
    await userEvent.click(screen.getByText('Technical details'));
    expect(screen.getByText('start_failed')).toBeVisible();
  });
  it('only offers recovery when supplied, and invokes explicit actions', async () => {
    const output = vi.fn();
    const retry = vi.fn();
    const { rerender } = render(<FailurePanel summary={summary} onViewOutput={output} />);
    expect(screen.queryByRole('button', { name: 'Retry options' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View build output' }));
    expect(output).toHaveBeenCalledOnce();
    rerender(<FailurePanel summary={summary} onViewOutput={output} onRetryOptions={retry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry options' }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('renders log content as text and does not fabricate absent metadata', () => {
    const { container } = render(
      <FailurePanel
        summary={{
          ...summary,
          code: undefined,
          evidence: [{ message: '<img src=x onerror=alert(1)>' }],
        }}
        onViewOutput={vi.fn()}
      />
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('time')).toBeNull();
    expect(screen.queryByText('Technical details')).not.toBeInTheDocument();
  });
});
