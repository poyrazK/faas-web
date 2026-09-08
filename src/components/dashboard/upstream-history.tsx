import { useState } from 'react';
import { Sparkline } from '@/components/dither-kit';
import { Select } from '@/components/ui/field';
import { Panel } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { errorMessage } from '@/lib/api/errors';
import { useUpstreamHistory } from '@/lib/api/queries';

/**
 * Probe history per declared upstream: what the platform measured reaching
 * each database or API over time, bucketed by the API.
 *
 * Buckets are a real series, so each upstream gets a sparkline of its p95 —
 * the shape is the point, since a database that got slower this afternoon is
 * invisible in a single current number. Buckets with no samples carry null
 * latencies and are left out of the line rather than drawn as zero, and the
 * last measured pair is stated in text so the number is legible without the
 * chart. Hosts stay hashed, as everywhere else in this surface.
 */

const BUCKETS = ['5m', '1h', '6h'] as const;

export function UpstreamHistoryPanel({ slug }: { slug: string }) {
  const [bucket, setBucket] = useState<string>('1h');
  const history = useUpstreamHistory(slug, bucket);
  const rows = history.data ?? [];

  return (
    <Panel
      title="Probe history"
      description="Reachability and latency the platform measured for each declared upstream, over the last 24 hours."
      actions={
        <Select
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          aria-label="Bucket size"
          className="h-8 text-xs"
        >
          {BUCKETS.map((b) => (
            <option key={b} value={b}>
              {b} buckets
            </option>
          ))}
        </Select>
      }
    >
      {history.isPending ? (
        <p className="text-sm text-muted-foreground">Reading probe history…</p>
      ) : history.error ? (
        <p className="text-sm text-muted-foreground">{errorMessage(history.error)}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No probe samples in this window. An upstream is probed once it has been declared and the
          app has run.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((row) => {
            const measured = row.buckets.filter((b) => b.p95_ms != null);
            const series = measured.map((b) => b.p95_ms as number);
            const last = measured[measured.length - 1];
            const samples = row.buckets.reduce((n, b) => n + b.sample_count, 0);
            return (
              <li
                key={`${row.host_redacted_hash}-${row.port}-${row.region}`}
                className="flex flex-wrap items-center gap-3 py-3 text-xs first:pt-0 last:pb-0"
              >
                <Pill label={row.kind} />
                <span className="font-mono" title="Hashed hostname">
                  {row.host_redacted_hash.slice(0, 12)}:{row.port}
                </span>
                <span className="text-muted-foreground">{row.region}</span>
                {row.deployment_scope && (
                  <span className="text-muted-foreground">{row.deployment_scope}</span>
                )}
                <span className="ml-auto [font-variant-numeric:tabular-nums]">
                  {last
                    ? `p50 ${Math.round(last.p50_ms ?? 0)} ms · p95 ${Math.round(last.p95_ms ?? 0)} ms`
                    : 'no successful probe'}
                </span>
                <span className="text-muted-foreground [font-variant-numeric:tabular-nums]">
                  {samples} samples
                </span>
                {series.length > 1 && (
                  <Sparkline data={series} color="green" className="h-8 w-24 shrink-0" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
