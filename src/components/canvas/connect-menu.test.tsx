import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectMenu } from './connect-menu';
import type { AppData } from './topology';

const app: AppData = {
  kind: 'app',
  slug: 'acme-api',
  phase: 'running',
  metrics: 'ready',
  connections: 'ready',
  buckets: { enabled: true, atLimit: false, defaultRegion: 'eu' },
};

describe('ConnectMenu', () => {
  it('offers domain and cron on the inbound side', () => {
    render(
      <ConnectMenu app={app} side="in" at={{ x: 0, y: 0 }} onPick={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText('Send traffic into acme-api')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /domain/i })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: /cron/i })).toBeEnabled();
  });

  it('explains a disabled bucket instead of hiding it', () => {
    render(
      <ConnectMenu
        app={{ ...app, buckets: { enabled: true, atLimit: true, defaultRegion: 'eu' } }}
        side="out"
        at={{ x: 0, y: 0 }}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('menuitem', { name: /bucket/i })).toBeDisabled();
    expect(screen.getByText(/bucket limit/i)).toBeInTheDocument();
  });

  it('waits for the bucket list before offering a bucket', () => {
    render(
      <ConnectMenu
        app={{ ...app, buckets: undefined }}
        side="out"
        at={{ x: 0, y: 0 }}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('menuitem', { name: /bucket/i })).toBeDisabled();
  });

  it('focuses its first choice without scrolling the canvas under it', () => {
    const focus = vi.spyOn(HTMLButtonElement.prototype, 'focus');
    render(
      <ConnectMenu app={app} side="in" at={{ x: 0, y: 0 }} onPick={vi.fn()} onClose={vi.fn()} />
    );
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });
  it('moves between choices with the arrow keys', () => {
    render(
      <ConnectMenu app={app} side="in" at={{ x: 0, y: 0 }} onPick={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByRole('menuitem', { name: /domain/i })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: /cron/i })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: /domain/i })).toHaveFocus();
  });

  it('keeps focus where the user put it when the app data refreshes', () => {
    const { rerender } = render(
      <ConnectMenu app={app} side="in" at={{ x: 0, y: 0 }} onPick={vi.fn()} onClose={vi.fn()} />
    );
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    rerender(
      <ConnectMenu
        app={{ ...app }}
        side="in"
        at={{ x: 0, y: 0 }}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('menuitem', { name: /cron/i })).toHaveFocus();
  });

  it('says storage is unavailable and offers a retry when the bucket read failed', () => {
    const onRetry = vi.fn();
    render(
      <ConnectMenu
        app={{ ...app, connections: 'error', buckets: undefined }}
        side="out"
        at={{ x: 0, y: 0 }}
        onPick={vi.fn()}
        onClose={vi.fn()}
        onRetry={onRetry}
      />
    );
    expect(screen.getByText('Storage unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
