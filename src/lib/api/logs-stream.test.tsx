import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogStream } from './logs';

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
});
