import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  useOpenAPIPreview,
  previewObservation,
  type OpenAPIPreview,
} from '@/lib/api/openapi-preview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/field';
import { Panel, InlinePhase, queryPhase } from './primitives';
import { Pill } from './resource-table';

const LABELS = {
  matched: 'Matched',
  declared_only: 'Declared only',
  observed_only: 'Observed only',
};
const PAGE_SIZE = 20;

export function OpenAPIRoutePreview({ slug }: { slug: string }) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  return <PreviewPanel key={`${accountId}:${slug}`} accountId={accountId} slug={slug} />;
}

function Observation({ data }: { data: OpenAPIPreview }) {
  const status = previewObservation(data);
  return (
    <div className="space-y-2 text-sm text-muted-foreground" role="status">
      <p>
        {status === 'unavailable'
          ? 'Live telemetry is unavailable.'
          : status === 'partial'
            ? 'Live telemetry is partial.'
            : 'Live telemetry available.'}{' '}
        {data.collectors_healthy} of {data.collectors_expected} expected collectors are healthy.
      </p>
      {data.observed_inventory_available && (
        <p>Retained discovered routes are included; they do not establish current live traffic.</p>
      )}
      {data.observed_cap_hit && <p>Route cap reached. This snapshot may omit routes.</p>}
      {!data.openapi_version && (
        <p>
          No imported declaration. Import a document below to compare declared and observed routes.
        </p>
      )}
      {data.routes.length === 0 && (
        <p>
          {status === 'live'
            ? 'No observations in this live snapshot. This does not establish complete API coverage.'
            : 'No routes returned. Incomplete observation cannot establish that the app has no routes.'}
        </p>
      )}
    </div>
  );
}

function PreviewPanel({ accountId, slug }: { accountId: string; slug: string }) {
  const query = useOpenAPIPreview(accountId, slug);
  const [text, setText] = useState('');
  const [classification, setClassification] = useState('all');
  const [page, setPage] = useState(0);
  const phase = queryPhase({
    error: query.error,
    loading: !accountId || query.isPending || query.isFetching,
  });
  const data = phase === 'ready' ? query.data : undefined;
  const filtered = (data?.routes ?? []).filter(
    (route) =>
      (classification === 'all' || route.status === classification) &&
      `${route.method} ${route.path}`.toLowerCase().includes(text.toLowerCase())
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  return (
    <Panel
      title="Route and policy preview"
      description="Compare the imported declaration with retained route observations and matching edge policies."
      actions={
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching || !accountId}
          onClick={() => void query.refetch()}
        >
          Refresh preview
        </Button>
      }
    >
      <InlinePhase
        phase={phase}
        error={query.error}
        loadingMessage="Reading route and policy evidence…"
        onRetry={() => void query.refetch()}
      />
      {data && (
        <div className="space-y-4">
          <Observation data={data} />
          <p className="text-xs text-muted-foreground">
            A policy match does not prove policy correctness or execution health. Missing
            observations do not prove a route is absent.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="Filter routes"
              placeholder="Filter by path or method"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setPage(0);
              }}
              className="min-w-0 flex-1"
            />
            <Select
              aria-label="Route provenance"
              value={classification}
              onChange={(event) => {
                setClassification(event.target.value);
                setPage(0);
              }}
            >
              <option value="all">All provenance</option>
              {Object.entries(LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {filtered.length} returned routes match the filter.
          </p>
          <ul aria-label="Compared routes" className="divide-y divide-border">
            {rows.map((route) => (
              <li key={`${route.method}:${route.path}`} className="space-y-2 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{route.method.toUpperCase()}</span>
                  <span className="min-w-0 break-all font-mono text-sm">{route.path}</span>
                  <Pill label={LABELS[route.status]} />
                  <Pill
                    label={
                      route.covered
                        ? 'Enabled policy match reported'
                        : 'No enabled policy match reported'
                    }
                  />
                </div>
                {route.rules.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Matching policy metadata ({route.rules.length})
                    </summary>
                    <ul className="mt-2 space-y-3">
                      {route.rules.map((rule) => (
                        <li key={rule.id} className="space-y-1 break-all">
                          <p>
                            {rule.enabled ? 'Enabled' : 'Disabled'} · {rule.kind} · {rule.id}
                          </p>
                          <p className="text-muted-foreground">
                            Host {rule.match_host}; path {rule.match_path}; methods{' '}
                            {rule.match_methods.length ? rule.match_methods.join(', ') : 'all'};
                            priority {rule.priority}
                            {rule.validate_mode ? `; validation ${rule.validate_mode}` : ''}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {filtered.length === 0 && data.routes.length > 0 && (
            <p className="text-sm text-muted-foreground">No returned routes match these filters.</p>
          )}
          {pages > 1 && (
            <nav
              aria-label="Preview route pages"
              className="flex items-center justify-between gap-2"
            >
              <Button
                variant="outline"
                size="sm"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                Previous routes
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {current + 1} of {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={current + 1 >= pages}
                onClick={() => setPage(current + 1)}
              >
                Next routes
              </Button>
            </nav>
          )}
        </div>
      )}
    </Panel>
  );
}
