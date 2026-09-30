import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LINES, useLogStream } from './logs';

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  onerror: ((event: Event) => void) | null = null;
  onopen: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public url: string,
    public options: EventSourceInit
  ) {
    super();
    FakeEventSource.instances.push(this);
  }
  emit(type: string, data?: string) {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data });
    this.dispatchEvent(event);
    if (type === 'error') this.onerror?.(event);
    if (type === 'open') this.onopen?.();
  }
}
const latest = () => FakeEventSource.instances.at(-1)!;
const emit = (type: string, data?: string) => act(() => latest().emit(type, data));
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('log stream recovery', () => {
  it('reconnects with capped backoff, preserving the buffer and credentials', () => {
    const { result } = renderHook(() => useLogStream({ kind: 'live', slug: 'api' }));
    emit('log', 'first');
    for (const delay of [1000, 2000, 4000, 8000, 16000]) {
      const count = FakeEventSource.instances.length;
      emit('error');
      expect(result.current.status).toBe('reconnecting');
      expect(latest().close).toHaveBeenCalledOnce();
      advance(delay - 1);
      expect(FakeEventSource.instances).toHaveLength(count);
      advance(1);
      expect(FakeEventSource.instances).toHaveLength(count + 1);
    }
    expect(latest().url).toBe('/v1/apps/api/logs?follow=1');
    expect(latest().options).toEqual({ withCredentials: true });
    emit('error');
    expect(result.current.status).toBe('error');
    expect(result.current.canRetry).toBe(true);
    advance(60000);
    expect(FakeEventSource.instances).toHaveLength(6);
    expect(result.current.lines.map((line) => line.text)).toEqual(['first']);
    act(() => result.current.retry());
    expect(result.current.status).toBe('connecting');
    expect(FakeEventSource.instances).toHaveLength(7);
    emit('open');
    emit('log', 'second');
    expect(result.current.status).toBe('streaming');
    expect(result.current.lines.map((line) => line.text)).toEqual(['first', 'second']);
  });

  it('resets the retry budget when a connection opens', () => {
    const { result } = renderHook(() => useLogStream({ kind: 'live', slug: 'api' }));
    emit('error');
    advance(1000);
    emit('error');
    advance(2000);
    emit('open');
    expect(result.current.status).toBe('streaming');
    emit('error');
    advance(1000);
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it.each(['end', 'error'])('does not retry terminal %s frames', (type) => {
    const { result } = renderHook(() => useLogStream({ kind: 'live', slug: 'api' }));
    emit(type, type === 'end' ? 'app_parked' : 'invalid_level');
    expect(result.current.status).toBe(type === 'end' ? 'ended' : 'error');
    expect(result.current.canRetry).toBe(false);
    emit('error');
    advance(60000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(result.current.reason).toBe(type === 'end' ? 'app_parked' : 'invalid_level');
  });
  it('cancels pending retries on pause and resumes with the existing buffer', () => {
    const { result, rerender } = renderHook(
      ({ connected }) => useLogStream({ kind: 'live', slug: 'api' }, connected),
      { initialProps: { connected: true } }
    );
    emit('log', 'before pause');
    emit('error');
    rerender({ connected: false });
    expect(result.current.status).toBe('paused');
    advance(60000);
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => result.current.retry());
    expect(FakeEventSource.instances).toHaveLength(1);
    rerender({ connected: true });
    emit('open');
    expect(result.current.lines[0].text).toBe('before pause');
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('ignores callbacks from retired connections and cancels retries on source changes', () => {
    const { result, rerender } = renderHook(({ slug }) => useLogStream({ kind: 'live', slug }), {
      initialProps: { slug: 'old' },
    });
    const old = latest();
    emit('error');
    rerender({ slug: 'new' });
    emit('log', 'new app');
    act(() => {
      old.emit('log', 'old app');
      old.emit('end', 'app_parked');
      old.emit('error');
      old.emit('open');
    });
    advance(60000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(result.current.status).toBe('streaming');
    expect(result.current.lines.map((line) => line.text)).toEqual(['new app']);
  });

  it('closes active connections and cancels timers on unmount', () => {
    const first = renderHook(() => useLogStream({ kind: 'live', slug: 'api' }));
    const connection = latest();
    first.unmount();
    expect(connection.close).toHaveBeenCalledOnce();
    act(() => connection.emit('error'));
    advance(60000);
    expect(FakeEventSource.instances).toHaveLength(1);
    const second = renderHook(() => useLogStream({ kind: 'live', slug: 'api' }));
    emit('error');
    second.unmount();
    advance(60000);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('recovers build logs but leaves a completed build closed', () => {
    const { result } = renderHook(() =>
      useLogStream({ kind: 'build', deploymentId: 'build-1', limit: 200 })
    );
    emit('error');
    advance(1000);
    expect(latest().url).toBe('/v1/deployments/build-1/logs?follow=1&limit=200');
    emit('log', 'build output');
    emit('end', 'build_complete');
    emit('error');
    advance(60000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(result.current.status).toBe('ended');
    expect(result.current.canRetry).toBe(false);
  });

  it('retains the bounded ring buffer through reconnection', () => {
    const { result } = renderHook(() => useLogStream({ kind: 'live', slug: 'api' }));
    act(() => {
      for (let i = 0; i <= MAX_LINES; i++) latest().emit('log', String(i));
    });
    emit('error');
    advance(1000);
    emit('log', 'after recovery');
    expect(result.current.lines).toHaveLength(MAX_LINES);
    expect(result.current.truncated).toBe(true);
    expect(result.current.lines[0].text).toBe('2');
    expect(result.current.lines.at(-1)?.text).toBe('after recovery');
  });

  it.each([true, false])('never automatically retries an archive (success=%s)', async (success) => {
    const fetcher = vi.fn().mockResolvedValue(
      success
        ? new Response('event: log\ndata: archived\n\nevent: end\ndata: archive_complete\n\n')
        : new Response(JSON.stringify({ title: 'Archive unavailable' }), {
            status: 403,
            headers: { 'Content-Type': 'application/problem+json' },
          })
    );
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() =>
      useLogStream({ kind: 'archive', slug: 'api', instance: 'i1', date: '2026-09-01' })
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.status).toBe(success ? 'ended' : 'error');
    expect(result.current.canRetry).toBe(false);
    act(() => result.current.retry());
    advance(60000);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('does not overwrite live output with a late archive response after switching sources', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          })
      )
    );
    const { result, rerender } = renderHook(
      ({ archive }) =>
        useLogStream(
          archive
            ? { kind: 'archive', slug: 'api', instance: 'i1', date: '2026-09-01' }
            : { kind: 'live', slug: 'api' }
        ),
      { initialProps: { archive: true } }
    );
    rerender({ archive: false });
    emit('log', 'live output');
    await act(async () => {
      resolve(new Response('event: log\ndata: stale archive\n\n'));
    });
    expect(result.current.status).toBe('streaming');
    expect(result.current.lines.map((line) => line.text)).toEqual(['live output']);
  });
});
