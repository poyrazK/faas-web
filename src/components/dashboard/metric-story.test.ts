import { describe, expect, it } from 'vitest';
import {
  busiestHour,
  countVerdict,
  debuggerSearch,
  rateVerdict,
  windowLabel,
  windowOptions,
} from './metric-story';

const hour = (h: number, requests: number, error_requests = 0) => ({
  start: `2026-11-02T${String(h).padStart(2, '0')}:00:00Z`,
  requests,
  error_requests,
  error_rate_pct: requests ? (error_requests / requests) * 100 : 0,
  cold_boots: 0,
  p50_ms: 10,
  p95_ms: 40 + h,
  p99_ms: 90,
});

describe('windows', () => {
  it('names presets in words and a timestamp as a custom window', () => {
    expect(windowLabel('1h')).toBe('Last hour');
    expect(windowLabel('24h')).toBe('Last 24 hours');
    expect(windowLabel('7d')).toBe('Last 7 days');
    expect(windowLabel('15m')).toBe('Last 15 minutes');
    expect(windowLabel('2026-11-02T00:00:00Z')).toBe('Custom window');
  });

  it('offers 1h, 24h and 7d, plus a preset the opener passed', () => {
    expect(windowOptions('24h')).toEqual(['1h', '24h', '7d']);
    expect(windowOptions('6h')).toEqual(['1h', '6h', '24h', '7d']);
    expect(windowOptions('15d')).toEqual(['1h', '24h', '7d', '15d']);
    expect(windowOptions('2026-11-02T00:00:00Z')).toEqual(['1h', '24h', '7d']);
  });
});

describe('verdicts', () => {
  const comparison = (before: number, after: number) => ({
    before,
    after,
    delta: before ? ((after - before) / before) * 100 : null,
  });

  it('reads request counts as busier, quieter or steady', () => {
    expect(countVerdict('requests', comparison(995, 1717))).toEqual({
      tone: 'neutral',
      label: 'Busier than earlier',
    });
    expect(countVerdict('requests', comparison(1000, 500))?.label).toBe('Quieter than earlier');
    expect(countVerdict('requests', comparison(1000, 1100))?.label).toBe('Steady');
    expect(countVerdict('requests', null)).toBeNull();
  });

  it('reads failures with a warning when they grow', () => {
    expect(countVerdict('errors', comparison(4, 20))).toEqual({
      tone: 'warning',
      label: 'More failures than earlier',
    });
    expect(countVerdict('errors', comparison(20, 4))?.tone).toBe('good');
    expect(countVerdict('errors', comparison(0, 0))).toEqual({
      tone: 'good',
      label: 'No failures',
    });
  });

  it('never gives latency a before/after verdict', () => {
    expect(countVerdict('p95', comparison(10, 50))).toBeNull();
  });

  it('grades an error rate on fixed bands', () => {
    expect(rateVerdict(0)).toEqual({ tone: 'good', label: 'No failures' });
    expect(rateVerdict(0.4)?.label).toBe('Healthy');
    expect(rateVerdict(2.4)).toEqual({ tone: 'warning', label: 'Worth a look' });
    expect(rateVerdict(9)).toEqual({ tone: 'critical', label: 'High' });
    expect(rateVerdict(null)).toBeNull();
  });
});

describe('busiestHour', () => {
  it('finds the hour with the most of the metric, skipping hours with no requests for rates', () => {
    const points = [hour(1, 10, 0), hour(2, 172, 1), hour(3, 0), hour(4, 50, 10)];
    expect(busiestHour('requests', points)).toMatchObject({ index: 1, value: 172 });
    expect(busiestHour('error_rate', points)).toMatchObject({ index: 3, value: 20 });
    expect(busiestHour('p95', points)).toMatchObject({ index: 3, value: 44 });
    expect(busiestHour('errors', [hour(1, 10, 0)])).toBeNull();
    expect(busiestHour('requests', [])).toBeNull();
  });
});

describe('debuggerSearch', () => {
  it('opens the matching requests in the Debugger', () => {
    expect(debuggerSearch('requests', '24h')).toEqual({
      tab: 'Debugger',
      debugView: 'requests',
      debugWindow: '24h',
    });
    expect(debuggerSearch('error_rate', '7d', '/orders')).toEqual({
      tab: 'Debugger',
      debugView: 'requests',
      debugWindow: '72h',
      debugFilter: 'failed',
      debugQuery: '/orders',
    });
    expect(debuggerSearch('p95', '1h').debugFilter).toBe('slow');
    expect(debuggerSearch('cold_rate', '6h')).toMatchObject({
      debugFilter: 'cold',
      debugWindow: '6h',
    });
    expect(debuggerSearch('requests', '2026-11-02T00:00:00Z').debugWindow).toBe('24h');
  });
});
