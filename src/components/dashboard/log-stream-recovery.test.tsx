import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LogStreamRecovery } from './log-stream-recovery';

describe('LogStreamRecovery', () => {
  it('announces automatic recovery without offering another connection', () => {
    render(<LogStreamRecovery status="reconnecting" canRetry={false} retry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting automatically');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('offers manual recovery after the automatic budget is exhausted', async () => {
    const retry = vi.fn();
    render(<LogStreamRecovery status="error" canRetry retry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Automatic recovery could not reconnect');
    await userEvent.click(screen.getByRole('button', { name: 'Retry log stream' }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('reports server refusals without offering to repeat the invalid request', () => {
    render(
      <LogStreamRecovery status="error" reason="invalid_level" canRetry={false} retry={vi.fn()} />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('invalid_level');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it.each(['connecting', 'streaming', 'paused', 'ended', 'idle'] as const)(
    'does not show a recovery control for %s',
    (status) => {
      const { container } = render(
        <LogStreamRecovery status={status} canRetry={false} retry={vi.fn()} />
      );
      expect(container).toBeEmptyDOMElement();
    }
  );
});
