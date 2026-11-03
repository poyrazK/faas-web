import { useState } from 'react';
import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, Select } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useCapabilityStage } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  ROUTE_HEALTH_LIMITS,
  routeProblem,
  useRouteHealthGate,
  useSetRouteHealthGate,
  type RouteHealthGate as Gate,
  type RouteHealthRoute,
} from '@/lib/api/route-health';
import { cn } from '@/lib/utils';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { SegmentedControl } from './tabs';

const METHODS: RouteHealthRoute['method'][] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];
type Mode = Gate['mode'];
type Recovery = NonNullable<Gate['on_regression']>;

function describe(route: RouteHealthRoute): string {
  const parts = ['5xx'];
  if (route.max_p95_ms) parts.push(`p95 ≤ ${route.max_p95_ms} ms`);
  if (route.check_latency) parts.push('1.5× slowdown');
  if (route.watch_statuses?.length) parts.push(`watching ${route.watch_statuses.join(', ')}`);
  if (route.probe) parts.push(`probed at ${route.probe.path}`);
  return parts.join(' · ');
}

/**
 * The critical-route guard on canary advances (faas handlers_route_health.go,
 * pkg/routehealth/health.go, docs/route-health.md). Report mode only shows the
 * comparison; enforce holds each traffic increase until every selected route
 * is healthy, for at most 24 hours, and `abort` also restores the stable
 * release on two confirmed 5xx windows. Saves name the revision they edit.
 * Mount it behind the `route-health-canary-guard` capability.
 */
export function RouteHealthGatePanel({ slug }: { slug: string }) {
  const gate = useRouteHealthGate(slug);
  const stage = useCapabilityStage('route-health-canary-guard');
  const [editing, setEditing] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const data = gate.data;
  const phase = queryPhase({ error: gate.error, loading: gate.isPending });
  return (
    <section aria-label="Critical route health">
      <Panel
        title="Critical route health"
        description={`${stage ? `${stage} · ` : ''}Compares 5xx and optional latency on selected routes between a canary and the release it replaces. Report only shows it; enforce holds the canary until those routes are healthy.`}
        actions={
          data &&
          !editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit routes
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {phase !== 'ready' || !data ? (
            <InlinePhase
              phase={phase}
              error={gate.error}
              loadingMessage="Reading the route health guard…"
              onRetry={() => void gate.refetch()}
            />
          ) : editing ? (
            <GateEditor
              slug={slug}
              gate={data}
              onDone={(saved) => {
                setEditing(false);
                setWarnings(saved?.warnings ?? []);
              }}
            />
          ) : (
            <>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>
                  Mode <span className="font-mono">{data.mode}</span>
                </span>
                <span>
                  On a confirmed regression{' '}
                  <span className="font-mono">{data.on_regression ?? 'hold'}</span>
                </span>
                <span className="text-muted-foreground">
                  Revision {data.revision}
                  {data.updated_at && (
                    <>
                      {' · changed '}
                      <Timestamp value={data.updated_at} />
                    </>
                  )}
                </span>
              </p>
              {data.routes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No routes selected. Report mode compares nothing until you add some; enforce needs
                  at least one.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {data.routes.map((r) => (
                    <li key={`${r.method} ${r.path}`} className="flex flex-wrap gap-x-3">
                      <span className="font-mono">
                        {r.method} {r.path}
                      </span>
                      <span className="text-xs text-muted-foreground">{describe(r)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {warnings.length > 0 && (
            <ul
              role="status"
              aria-label="Warnings from the save"
              className="flex flex-col gap-1 text-xs"
              style={{ color: 'var(--status-warning)' }}
            >
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </section>
  );
}

function GateEditor({
  slug,
  gate,
  onDone,
}: {
  slug: string;
  gate: Gate;
  onDone: (saved?: Gate) => void;
}) {
  const save = useSetRouteHealthGate(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>(gate.mode);
  const [recovery, setRecovery] = useState<Recovery>(gate.on_regression ?? 'hold');
  const [routes, setRoutes] = useState<RouteHealthRoute[]>(gate.routes);
  const [failure, setFailure] = useState('');
  const [tried, setTried] = useState(false);
  const probes = routes.filter((r) => r.probe).length;
  const duplicate = routes.find(
    (r, i) => routes.findIndex((x) => x.method === r.method && x.path === r.path) !== i
  );
  const problems = routes.map(routeProblem);
  const formProblem =
    mode === 'enforce' && routes.length === 0
      ? 'Enforce needs at least one route.'
      : routes.length > ROUTE_HEALTH_LIMITS.routes
        ? `At most ${ROUTE_HEALTH_LIMITS.routes} routes.`
        : probes > ROUTE_HEALTH_LIMITS.probes
          ? `At most ${ROUTE_HEALTH_LIMITS.probes} routes can be probed.`
          : duplicate
            ? `${duplicate.method} ${duplicate.path} is listed twice.`
            : recovery === 'abort' && mode !== 'enforce'
              ? 'Automatic recovery needs enforce mode.'
              : undefined;
  const invalid = Boolean(formProblem) || problems.some(Boolean);

  const patch = (i: number, next: Partial<RouteHealthRoute>) =>
    setRoutes((rs) => rs.map((r, j) => (j === i ? { ...r, ...next } : r)));

  const submit = async () => {
    setTried(true);
    if (invalid || save.isPending) return;
    const ok = await confirm({
      title: `Save the route health guard for ${slug}?`,
      description:
        mode === 'enforce'
          ? `Each canary of ${slug} then takes more traffic only when all ${routes.length} selected route${routes.length === 1 ? ' is' : 's are'} healthy, and a canary held for 24 hours is aborted and the stable release restored.${recovery === 'abort' ? ' Two confirmed 5xx windows on a selected route also abort the canary at once.' : ''} The change applies to canaries' next increases and needs fresh observations.`
          : `Report mode compares the ${routes.length} selected route${routes.length === 1 ? '' : 's'} without holding any canary.`,
      confirmLabel: 'Save guard',
      destructive: mode === 'enforce',
    });
    if (!ok) return;
    setFailure('');
    try {
      const saved = await save.mutateAsync({
        mode,
        on_regression: recovery,
        expected_revision: gate.revision,
        routes,
      });
      toast({
        kind: 'success',
        title: 'Route health guard saved',
        description: `Revision ${saved.revision}.`,
      });
      onDone(saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') {
        setFailure(
          'Someone changed the guard while you edited it. Close, read the new version, and edit again.'
        );
        return;
      }
      setFailure(
        err instanceof ApiError && err.code === 'plan_traffic_split_not_allowed'
          ? 'Enforcement needs traffic splits and request telemetry on your plan; report mode works on any plan.'
          : errorMessage(err)
      );
    }
  };

  return (
    <form
      noValidate
      aria-label="Route health guard"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Mode</span>
          <SegmentedControl<Mode>
            label="Guard mode"
            value={mode}
            options={[
              { key: 'report', label: 'Report' },
              { key: 'enforce', label: 'Enforce' },
            ]}
            onChange={setMode}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">On a confirmed 5xx regression</span>
          <SegmentedControl<Recovery>
            label="On a confirmed regression"
            value={recovery}
            options={[
              { key: 'hold', label: 'Hold' },
              { key: 'abort', label: 'Abort and restore' },
            ]}
            onChange={setRecovery}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Paths are gateway-normalized telemetry labels, such as{' '}
        <code className="font-mono">/profiles/{'{id}'}</code>, as the debugger shows them. Each
        route needs 20 requests on both releases in each of two closed minutes; latency checks need
        100.
      </p>
      <ul className="flex flex-col gap-3">
        {routes.map((route, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Method</span>
                <Select
                  aria-label={`Route ${i + 1} method`}
                  value={route.method}
                  onChange={(e) => {
                    const method = e.target.value as RouteHealthRoute['method'];
                    patch(i, {
                      method,
                      ...(method !== 'GET' && method !== 'HEAD' ? { probe: undefined } : {}),
                    });
                  }}
                >
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </label>
              <label className="flex min-w-48 flex-1 flex-col gap-1">
                <span className="text-xs text-muted-foreground">Path</span>
                <input
                  aria-label={`Route ${i + 1} path`}
                  value={route.path}
                  onChange={(e) => patch(i, { path: e.target.value.trim() })}
                  className={cn(FIELD, 'w-full font-mono')}
                />
              </label>
              <label className="flex w-36 flex-col gap-1">
                <span className="text-xs text-muted-foreground">p95 budget (ms)</span>
                <input
                  aria-label={`Route ${i + 1} p95 budget`}
                  type="number"
                  min={0}
                  value={route.max_p95_ms ?? ''}
                  onChange={(e) =>
                    patch(i, {
                      max_p95_ms:
                        e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)),
                    })
                  }
                  placeholder="off"
                  className={cn(FIELD, 'w-full')}
                />
              </label>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-label={`Remove route ${i + 1}`}
                onClick={() => setRoutes((rs) => rs.filter((_, j) => j !== i))}
              >
                <Trash className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={Boolean(route.check_latency)}
                  onChange={(e) => patch(i, { check_latency: e.target.checked || undefined })}
                />
                Hold on a 1.5× slowdown
              </label>
              <fieldset className="flex flex-wrap items-center gap-2">
                <legend className="sr-only">Watched 4xx statuses for route {i + 1}</legend>
                <span className="text-muted-foreground">Watch</span>
                {ROUTE_HEALTH_LIMITS.watchStatuses.map((code) => (
                  <label key={code} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={route.watch_statuses?.includes(code) ?? false}
                      onChange={(e) => {
                        const set = new Set(route.watch_statuses ?? []);
                        if (e.target.checked) set.add(code);
                        else set.delete(code);
                        patch(i, {
                          watch_statuses: set.size
                            ? ROUTE_HEALTH_LIMITS.watchStatuses.filter((c) => set.has(c))
                            : undefined,
                        });
                      }}
                    />
                    {code}
                  </label>
                ))}
              </fieldset>
              {(route.method === 'GET' || route.method === 'HEAD') && (
                <label className="flex items-center gap-1.5">
                  Probe at
                  <input
                    aria-label={`Route ${i + 1} probe path`}
                    value={route.probe?.path ?? ''}
                    onChange={(e) =>
                      patch(i, {
                        probe: e.target.value.trim() ? { path: e.target.value.trim() } : undefined,
                      })
                    }
                    placeholder="/profiles/42"
                    className={cn(FIELD, 'h-7 w-36 font-mono text-xs')}
                  />
                </label>
              )}
            </div>
            {tried && problems[i] && <FieldError id={`route-${i}-error`}>{problems[i]}</FieldError>}
          </li>
        ))}
      </ul>
      <div>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="gap-1.5"
          disabled={routes.length >= ROUTE_HEALTH_LIMITS.routes}
          onClick={() => setRoutes((rs) => [...rs, { method: 'GET', path: '/' }])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add route
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        4xx watches are advisory and never hold a canary. A probe sends a few bodyless requests a
        minute to both releases while organic traffic is sparse; at most{' '}
        {ROUTE_HEALTH_LIMITS.probes} routes.
      </p>
      {tried && formProblem && <FieldError id="route-health-form-error">{formProblem}</FieldError>}
      {failure && (
        <p role="alert" className="text-xs text-[color:var(--status-critical)]">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" busy={save.isPending}>
          Save guard
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
