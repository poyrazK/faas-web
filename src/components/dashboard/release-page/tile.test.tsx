import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReleaseTile } from './tile';

afterEach(cleanup);

function tile(overrides: Partial<Parameters<typeof ReleaseTile>[0]> = {}) {
  const onOpen = vi.fn();
  const onRetry = vi.fn();
  render(
    <ReleaseTile
      title="Security"
      phase="ready"
      value="0 critical"
      line="2 low · no secrets found"
      hint="All findings"
      onOpen={onOpen}
      onRetry={onRetry}
      {...overrides}
    />
  );
  return { onOpen, onRetry };
}

describe('ReleaseTile', () => {
  it('shows its fact and opens its popup when clicked', async () => {
    const { onOpen } = tile();
    expect(screen.getByText('0 critical')).toBeInTheDocument();
    expect(screen.getByText('2 low · no secrets found')).toBeInTheDocument();
    expect(screen.getByText('All findings')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Security' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows no value while loading', () => {
    tile({ phase: 'loading' });
    expect(screen.queryByText('0 critical')).not.toBeInTheDocument();
  });

  it('says what is missing when empty', () => {
    tile({ phase: 'empty', emptyMessage: 'Not scanned' });
    expect(screen.getByText('Not scanned')).toBeInTheDocument();
    expect(screen.queryByText('0 critical')).not.toBeInTheDocument();
  });

  it('retries an unreachable read without opening the popup', async () => {
    const { onOpen, onRetry } = tile({ phase: 'unreachable', error: new Error('offline') });
    expect(screen.getByText('Could not reach the API.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open Security' })).toBeInTheDocument();
  });
});
