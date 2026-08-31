import type { components } from '@/lib/api/schema';

export type MirrorRule = components['schemas']['MirrorRuleResponse'];
export type MirrorSummary = components['schemas']['MirrorSummaryResponse'];

/** The spec declares no defaults, so the console picks these and sends them explicitly. */
export const MIRROR_DEFAULTS = {
  percent: 100,
  include_body: false,
  redact_headers: ['authorization', 'cookie'],
} as const;

const signed = (ms: number) => (ms < 0 ? `−${Math.abs(ms)} ms` : `+${ms} ms`);
const windowLabel = (s: number) =>
  s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 ? `${s / 60} min` : `${s} s`;

export function mirrorSummaryRows(s: MirrorSummary): [string, string][] {
  return [
    ['Window', windowLabel(s.window_seconds)],
    ['Mirrored requests', s.total_invocations.toLocaleString('en-US')],
    ['Status differs', String(s.status_diff_count)],
    ['Schema differs', String(s.schema_diff_count)],
    ['Body differs', String(s.body_diff_count)],
    ['Mean latency Δ', signed(s.mean_latency_diff_ms)],
    ['p99 latency Δ', signed(s.p99_latency_diff_ms)],
    ['Crashes', String(s.crash_count)],
  ];
}
