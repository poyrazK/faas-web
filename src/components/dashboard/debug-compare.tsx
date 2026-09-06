import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InlinePhase } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useApps, useCompareDeployments, useDeployments } from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { DebugGate, isPlanGated } from './debug-gate';
import { WINDOWS } from './debug-requests';

/**
 * Per-route latency for two deployments over one window.
 *
 * The request body calls them `source` and `mirror`, but `debugCompareHandler`
 * runs the same per-route query against each id — no mirror relationship is
 * required. So this answers the question people actually have after shipping:
 * did the new deployment make this route slower than the old one?
 *
 * A missing side means the deployment served no traffic on that route in the
 * window. The API is explicit that it does not synthesise the absent
 * percentiles from the other side, and neither does this: an empty cell reads
 * as "no traffic", never as zero milliseconds.
 */

interface Row {
  id: string;
  route: string;
  sourceP50: number | null;
  sourceP95: number | null;
  sourceCount: number | null;
  mirrorP50: number | null;
  mirrorP95: number | null;
  mirrorCount: number | null;
}

function ms(v: number | null): string {
  return v == null ? '—' : `${v} ms`;
}

/** The delta only means something when both sides actually served traffic. */
function delta(a: number | null, b: number | null): { text: string; color: string } | null {
  if (a == null || b == null || a === 0) return null;
  const factor = b / a;
  if (factor >= 1.1)
    return { text: `${factor.toFixed(2)}× slower`, color: 'var(--status-critical)' };
  if (factor <= 0.9)
    return { text: `${(1 / factor).toFixed(2)}× faster`, color: 'var(--status-good)' };
  return { text: 'about the same', color: 'var(--muted-foreground)' };
}

export function DebugCompare({ slug }: { slug: string }) {
  // There is no GET for per-app deployments — /v1/apps/{slug}/deployments is
  // POST-only — so the account-wide list is filtered to this app by id.
  const deployments = useDeployments(100);
  const apps = useApps();
  const compare = useCompareDeployments(slug);
  const [source, setSource] = useState('');
  const [mirror, setMirror] = useState('');
  const [since, setSince] = useState('24h');

  const options = useMemo(() => {
    const appId = (apps.data ?? []).find((a) => a.slug === slug)?.id;
    return (deployments.data?.items ?? [])
      .filter((d) => !appId || d.app_id === appId)
      .map((d) => ({ id: d.id, label: `${d.status} · ${d.id.slice(0, 8)}` }));
  }, [deployments.data, apps.data, slug]);

  const rows: Row[] = (compare.data?.routes ?? []).map((r) => ({
    id: r.route,
    route: r.route,
    sourceP50: r.source_p50_ms ?? null,
    sourceP95: r.source_p95_ms ?? null,
    sourceCount: r.source_count ?? null,
    mirrorP50: r.mirror_p50_ms ?? null,
    mirrorP95: r.mirror_p95_ms ?? null,
    mirrorCount: r.mirror_count ?? null,
  }));

  const columns: Column<Row>[] = [
    {
      key: 'route',
      label: 'Route template',
      render: (r) => <span className="font-mono text-xs">{r.route}</span>,
    },
    {
      key: 'sourceP95',
      label: 'A · p95',
      numeric: true,
      render: (r) => <span className="[font-variant-numeric:tabular-nums]">{ms(r.sourceP95)}</span>,
    },
    {
      key: 'mirrorP95',
      label: 'B · p95',
      numeric: true,
      render: (r) => <span className="[font-variant-numeric:tabular-nums]">{ms(r.mirrorP95)}</span>,
    },
    {
      key: 'id',
      label: 'Change',
      render: (r) => {
        const d = delta(r.sourceP95, r.mirrorP95);
        return d ? (
          <span className="text-xs font-medium" style={{ color: d.color }}>
            {d.text}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">no traffic both sides</span>
        );
      },
    },
    {
      key: 'sourceCount',
      label: 'A · requests',
      numeric: true,
      render: (r) => (
        <span className="[font-variant-numeric:tabular-nums] text-muted-foreground">
          {r.sourceCount ?? '—'}
        </span>
      ),
    },
    {
      key: 'mirrorCount',
      label: 'B · requests',
      numeric: true,
      render: (r) => (
        <span className="[font-variant-numeric:tabular-nums] text-muted-foreground">
          {r.mirrorCount ?? '—'}
        </span>
      ),
    },
  ];

  const ready = source !== '' && mirror !== '' && source !== mirror;

  return (
    <DebugGate error={isPlanGated(compare.error) ? compare.error : null}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          {[['A', source, setSource] as const, ['B', mirror, setMirror] as const].map(
            ([label, value, set]) => (
              <label key={label} className="flex flex-col gap-1.5">
                <span className="label-mono text-muted-foreground">Deployment {label}</span>
                <select
                  aria-label={`Deployment ${label}`}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  className="h-9 min-w-52 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
                >
                  <option value="">Choose a deployment…</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )
          )}

          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Window</span>
            <select
              aria-label="Compare window"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
            >
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>

          <Button
            size="sm"
            disabled={!ready}
            busy={compare.isPending}
            onClick={() =>
              void compare.mutateAsync({ source, mirror, since }).catch(() => undefined)
            }
          >
            Compare
          </Button>
        </div>

        {source !== '' && source === mirror && (
          <p className="text-xs text-[color:var(--status-warning)]">
            Pick two different deployments — comparing one with itself says nothing.
          </p>
        )}

        {compare.error && !isPlanGated(compare.error) && (
          <p className="text-sm text-[color:var(--status-critical)]">
            {errorMessage(compare.error)}
          </p>
        )}

        {compare.data ? (
          <ResourceTable
            rows={rows}
            columns={columns}
            initialSort={{ key: 'route', dir: 'asc' }}
            searchKeys={['route']}
            searchPlaceholder="Filter by route…"
            emptyMessage="Neither deployment served traffic in this window."
            minWidth="min-w-[860px]"
          />
        ) : (
          <InlinePhase
            phase="empty"
            emptyMessage="Choose two deployments to compare their per-route latency."
          />
        )}
      </div>
    </DebugGate>
  );
}
