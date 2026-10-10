import { render, screen } from '@testing-library/react';
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
});
