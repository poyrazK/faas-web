import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { postgresRead, toRead } from './use-topology';

const q = <T>(
  over: Partial<{ data: T; error: unknown; isPending: boolean; fetchStatus: string }>
) => ({
  data: undefined as T | undefined,
  error: null as unknown,
  isPending: false,
  fetchStatus: 'idle',
  ...over,
});

describe('toRead', () => {
  it('prefers data, then error, then loading', () => {
    expect(toRead(q({ data: 1 }))).toEqual({ status: 'ready', data: 1 });
    expect(toRead(q({ error: 'x' }))).toEqual({ status: 'error', error: 'x' });
    expect(toRead(q({ isPending: true, fetchStatus: 'fetching' }))).toEqual({ status: 'loading' });
  });
});

describe('postgresRead', () => {
  const db = { id: 'db1', name: 'main', state: 'ready' } as never;

  it('treats a forbidden or missing Postgres surface as absent', () => {
    for (const status of [403, 404]) {
      const error = new ApiError({ status, code: 'not_enabled', title: 'nope' });
      expect(postgresRead(q({ error }), [])).toEqual({
        status: 'ready',
        data: { databases: [], bindings: [] },
      });
    }
  });

  it('keeps a real failure an error', () => {
    const error = new ApiError({ status: 500, code: 'internal', title: 'boom' });
    expect(postgresRead(q({ error }), []).status).toBe('error');
  });

  it('waits for every database’s bindings before it is ready', () => {
    const dbs = q({ data: { items: [db] } });
    expect(postgresRead(dbs, [q({ isPending: true, fetchStatus: 'fetching' })]).status).toBe(
      'loading'
    );
    expect(postgresRead(dbs, [q({ data: { items: [{ id: 'b' } as never] } })])).toEqual({
      status: 'ready',
      data: { databases: [db], bindings: [{ id: 'b' }] },
    });
  });
});
