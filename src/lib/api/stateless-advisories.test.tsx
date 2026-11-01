import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import {
  ADVISORY_LIMIT,
  statelessFindings,
  useStatelessAdvisories,
  type AuditEvent,
} from './stateless-advisories';

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) }) as never;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

afterEach(() => vi.restoreAllMocks());

const advisory = (
  id: string,
  at: string,
  events: { path: string; mask?: string }[],
  instance = 'inst-1'
): AuditEvent => ({
  id,
  at,
  actor: 'apid',
  kind: 'stateless.advisory',
  data: {
    app_id: 'app-uuid',
    instance,
    count: events.length,
    events: events.map((event) => ({
      path: event.path,
      mask: event.mask ?? 'modify',
      pid: 7,
      ts_unix_ms: Date.parse(at),
    })),
  },
});

describe('useStatelessAdvisories', () => {
  it("reads only this app's stateless advisories, and only once the app id is known", async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ events: [], limit: ADVISORY_LIMIT }));
    const { rerender } = renderHook(({ id }: { id: string }) => useStatelessAdvisories(id), {
      wrapper,
      initialProps: { id: '' },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(get).not.toHaveBeenCalled();
    rerender({ id: 'app-uuid' });
    await waitFor(() => expect(get).toHaveBeenCalledOnce());
    expect(get).toHaveBeenCalledWith(
      '/v1/audit-events',
      expect.objectContaining({
        params: {
          query: { kind_prefix: 'stateless.advisory', app_id: 'app-uuid', limit: ADVISORY_LIMIT },
        },
      })
    );
  });
});

describe('statelessFindings', () => {
  it('groups writes by the watched path, with the backend severity and remediation', () => {
    const findings = statelessFindings([
      advisory('3', '2026-10-31T10:05:00Z', [{ path: '/var/lib/redis/dump.rdb', mask: 'create' }]),
      advisory(
        '2',
        '2026-10-31T10:00:00Z',
        [{ path: '/data/index/seg-1', mask: 'create,modify' }, { path: '/data/index/seg-2' }],
        'inst-2'
      ),
      advisory('1', '2026-10-31T09:00:00Z', [{ path: '/data/index/seg-1', mask: 'move' }]),
    ]);
    // High (data, db, postgres, mysql) before warn, whatever the recency.
    expect(findings.map((finding) => [finding.root, finding.severity])).toEqual([
      ['/data', 'high'],
      ['/var/lib/redis', 'warn'],
    ]);
    const data = findings[0];
    expect(data.paths).toEqual(['/data/index/seg-1', '/data/index/seg-2']);
    expect(data.operations).toEqual(['create', 'modify', 'move']);
    expect(data.batches).toBe(2);
    expect(data.writes).toBe(3);
    expect(data.lastSeen).toBe('2026-10-31T10:00:00Z');
    expect(data.instances).toEqual(['inst-2', 'inst-1']);
    expect(data.fix).toMatch(/managed service/i);
    // The daemon directories carry the deny-list's provider hint.
    expect(findings[1].fix).toMatch(/Upstash/);
  });

  it('matches watched roots on a path boundary, not a string prefix', () => {
    const [mongo, mongodb] = statelessFindings([
      advisory('2', '2026-10-31T10:00:00Z', [{ path: '/var/lib/mongo/wt' }]),
      advisory('1', '2026-10-31T09:00:00Z', [{ path: '/var/lib/mongodb/wt' }]),
    ]);
    expect(mongo.root).toBe('/var/lib/mongo');
    expect(mongodb.root).toBe('/var/lib/mongodb');
    expect(
      statelessFindings([advisory('1', '2026-10-31T09:00:00Z', [{ path: '/database/x' }])])[0]
    ).toMatchObject({ root: '/database/x', severity: 'warn' });
  });

  it('skips empty batches and rows that are not stateless advisories', () => {
    expect(
      statelessFindings([
        advisory('2', '2026-10-31T10:00:00Z', []),
        { ...advisory('1', '2026-10-31T09:00:00Z', [{ path: '/data/x' }]), kind: 'auth.login' },
        {
          id: '0',
          at: '2026-10-31T08:00:00Z',
          actor: 'apid',
          kind: 'stateless.advisory',
          data: {},
        },
      ])
    ).toEqual([]);
  });
});
