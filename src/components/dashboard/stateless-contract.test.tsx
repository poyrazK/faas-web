import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { AuditEvent } from '@/lib/api/stateless-advisories';

const useApp = vi.fn();
const useStatelessAdvisories = vi.fn();
vi.mock('@/lib/api/queries', () => ({
  useApp: (slug: string) => useApp(slug) as unknown,
}));
vi.mock('@/lib/api/stateless-advisories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/stateless-advisories')>()),
  useStatelessAdvisories: (id: string) => useStatelessAdvisories(id) as unknown,
}));
const { StatelessContract } = await import('./stateless-contract');

const read = (data: unknown, extra: object = {}) => ({
  data,
  isPending: false,
  error: null,
  refetch: vi.fn(),
  ...extra,
});

const advisory = (id: string, path: string, mask = 'modify'): AuditEvent => ({
  id,
  at: new Date(Date.now() - Number(id) * 60_000).toISOString(),
  actor: 'apid',
  kind: 'stateless.advisory',
  severity: path.startsWith('/data') ? 'high' : 'warn',
  data: {
    app_id: 'app-uuid',
    instance: 'inst-7f2c',
    count: 1,
    events: [{ path, mask, pid: 41, ts_unix_ms: 0 }],
  },
});

beforeEach(() => {
  useApp.mockReset().mockReturnValue(read({ id: 'app-uuid', slug: 'search-indexer' }));
  useStatelessAdvisories.mockReset();
});

describe('StatelessContract', () => {
  it('lists each watched path written, with its severity, operations and fix', () => {
    useStatelessAdvisories.mockReturnValue(
      read({
        events: [
          advisory('1', '/var/lib/redis/dump.rdb', 'create'),
          advisory('2', '/data/index/seg-1', 'create,modify'),
        ],
        limit: 100,
      })
    );
    render(<StatelessContract slug="search-indexer" />);
    expect(useApp).toHaveBeenCalledWith('search-indexer');
    expect(useStatelessAdvisories).toHaveBeenLastCalledWith('app-uuid');
    const region = screen.getByRole('region', { name: 'Stateless contract' });
    const rows = within(region).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('/data');
    expect(rows[0]).toHaveTextContent(/high/i);
    expect(rows[0]).toHaveTextContent('/data/index/seg-1');
    expect(rows[0]).toHaveTextContent(/create, modify/);
    expect(rows[0]).toHaveTextContent('inst-7f2c');
    expect(rows[0]).toHaveTextContent(/managed service/i);
    expect(rows[1]).toHaveTextContent('/var/lib/redis');
    expect(rows[1]).toHaveTextContent(/warn/i);
    expect(rows[1]).toHaveTextContent(/Upstash/);
    // Plain about what this is and is not.
    expect(region).toHaveTextContent(/lost when the instance parks/i);
    expect(region).toHaveTextContent(/not a guarantee/i);
    expect(within(region).getByRole('link', { name: /storage/i })).toHaveAttribute(
      'href',
      '/docs/storage'
    );
    // Nothing to run: the rows are stored, so there is no review button.
    expect(within(region).queryByRole('button', { name: /review|scan|check/i })).toBeNull();
  });

  it('says when nothing has been seen, without claiming the app is stateless', () => {
    useStatelessAdvisories.mockReturnValue(read({ events: [], limit: 100 }));
    render(<StatelessContract slug="search-indexer" />);
    const region = screen.getByRole('region', { name: 'Stateless contract' });
    expect(region).toHaveTextContent(/no writes to watched paths/i);
    expect(within(region).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('says the window is partial when the newest batches fill the limit', () => {
    useStatelessAdvisories.mockReturnValue(
      read({
        events: Array.from({ length: 100 }, (_, i) => advisory(String(i + 1), '/data/x')),
        limit: 100,
      })
    );
    render(<StatelessContract slug="search-indexer" />);
    expect(screen.getByRole('region', { name: 'Stateless contract' })).toHaveTextContent(
      /newest 100 batches/i
    );
  });

  it('waits for the app id rather than spinning on a disabled read', () => {
    useApp.mockReturnValue({ data: undefined, isPending: true, error: null, refetch: vi.fn() });
    useStatelessAdvisories.mockReturnValue({
      data: undefined,
      isPending: true,
      error: null,
      refetch: vi.fn(),
    });
    render(<StatelessContract slug="search-indexer" />);
    expect(useStatelessAdvisories).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('shows the API error with a retry', () => {
    const refetch = vi.fn();
    useStatelessAdvisories.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        code: 'scope_denied',
        detail: 'This key cannot read audit events.',
      }),
      refetch,
    });
    render(<StatelessContract slug="search-indexer" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot read audit events/);
    screen.getByRole('button', { name: /try again/i }).click();
    expect(refetch).toHaveBeenCalled();
  });
});
