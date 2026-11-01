import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  access: {} as Record<string, string>,
  maturity: undefined as string | undefined,
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({ access: state.access[id] ?? 'on' }),
  useCapability: (key: string) => ({
    capability: key === 'log-drains' && state.maturity ? { maturity: state.maturity } : undefined,
  }),
}));

const { useLogDrainKinds, useLogDrainStage } = await import('./log-drain-capabilities');

beforeEach(() => {
  state.access = {};
  state.maturity = undefined;
});

describe('useLogDrainKinds', () => {
  it('offers Datadog only once the registry says datadog-integration is on', () => {
    expect(renderHook(() => useLogDrainKinds()).result.current).toEqual([
      'http_json',
      'otlp',
      'datadog',
    ]);
    for (const access of ['off', 'loading', 'registry-error']) {
      state.access = { 'datadog-integration': access };
      expect(renderHook(() => useLogDrainKinds()).result.current).toEqual(['http_json', 'otlp']);
    }
  });
});

describe('useLogDrainStage', () => {
  it("reads the stage from the log-drains capability's maturity", () => {
    expect(renderHook(() => useLogDrainStage()).result.current).toBe('');
    state.maturity = 'beta';
    expect(renderHook(() => useLogDrainStage()).result.current).toBe('Beta');
    state.maturity = 'preview';
    expect(renderHook(() => useLogDrainStage()).result.current).toBe('Preview');
    state.maturity = 'ga';
    expect(renderHook(() => useLogDrainStage()).result.current).toBe('');
  });
});
