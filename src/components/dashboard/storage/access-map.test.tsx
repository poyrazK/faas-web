import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AccessConnection } from '@/lib/storage-access';
import { AccessMap } from './access-map';

const connections: AccessConnection[] = [
  { id: 'binding:1', lane: 'app', label: 'GREGALE_S3_ASSETS', permission: 'read' },
  { id: 'grant:k', lane: 'api-key', label: 'deploy', permission: 'write' },
  { id: 's3:c', lane: 's3-key', label: 'ci-backup', permission: 'read_write' },
];

describe('AccessMap', () => {
  it('sums up who can read and who can write, for screen readers and at a glance', () => {
    render(
      <AccessMap bucket="assets" app="api-gateway" connections={connections} onSelect={vi.fn()} />
    );
    const map = screen.getByRole('figure', { name: /who can reach assets/i });
    expect(map).toHaveTextContent('2 can read');
    expect(map).toHaveTextContent('2 can write');
    expect(within(map).getByText('s3://assets')).toBeInTheDocument();
  });

  it('lists each connection in its lane with what it may do', () => {
    render(
      <AccessMap bucket="assets" app="api-gateway" connections={connections} onSelect={vi.fn()} />
    );
    const appLane = screen.getByRole('group', { name: 'api-gateway code' });
    expect(
      within(appLane).getByRole('button', { name: /GREGALE_S3_ASSETS.*reads/ })
    ).toBeInTheDocument();
    const keys = screen.getByRole('group', { name: 'API keys' });
    expect(within(keys).getByRole('button', { name: /deploy.*writes/ })).toBeInTheDocument();
    const s3 = screen.getByRole('group', { name: 'S3 keys' });
    expect(
      within(s3).getByRole('button', { name: /ci-backup.*reads and writes/ })
    ).toBeInTheDocument();
  });

  it('says when a key is mid-rotation', () => {
    render(
      <AccessMap
        bucket="assets"
        app="api-gateway"
        connections={[{ ...connections[0], pending: true }]}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /rotating key/ })).toBeInTheDocument();
  });

  it('opens the connection a person picks', async () => {
    const onSelect = vi.fn();
    render(
      <AccessMap bucket="assets" app="api-gateway" connections={connections} onSelect={onSelect} />
    );
    await userEvent.click(screen.getByRole('button', { name: /deploy/ }));
    expect(onSelect).toHaveBeenCalledWith(connections[1]);
  });

  it('offers to connect the app when nothing can reach the bucket yet', async () => {
    const onConnect = vi.fn();
    render(
      <AccessMap
        bucket="assets"
        app="api-gateway"
        connections={[]}
        onSelect={vi.fn()}
        onConnect={onConnect}
      />
    );
    expect(screen.getByRole('figure')).toHaveTextContent('Nothing can reach this bucket yet');
    await userEvent.click(screen.getByRole('button', { name: 'Connect api-gateway' }));
    expect(onConnect).toHaveBeenCalled();
  });
});
