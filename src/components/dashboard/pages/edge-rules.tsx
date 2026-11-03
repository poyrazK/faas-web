import { CapabilityNotice } from '@/components/dashboard/capability-notice';
import { CorsPresetsPanel } from '@/components/dashboard/cors-presets';
import { EdgeRuleDialog } from '@/components/dashboard/edge-rules/dialog';
import { EdgeRulesExtras } from '@/components/dashboard/edge-rules/edge-rules-extras';
import { explainRule } from '@/components/dashboard/edge-rules/explain';
import { KINDS, type Kind, summarise } from '@/components/dashboard/edge-rules/kinds';
import { MaturityLabel } from '@/components/dashboard/maturity-label';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Tabs, tabId } from '@/components/dashboard/tabs';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { slugIndex } from '@/lib/api/adapters';
import { useCapability, useCapabilityAccess } from '@/lib/api/capabilities';
import { ruleAction } from '@/lib/api/edge-rules';
import {
  useAppEdgeRules,
  useApps,
  useDeleteEdgeRule,
  useEdgeRules,
  useUpdateEdgeRule,
  type EdgeRule,
} from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { summariseMatch } from '@/lib/edge-rule-match';
import { ArrowDown, ArrowUp, Eye, Plus, Trash } from 'iconoir-react';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * Rules the gateway applies before a request reaches an app.
 *
 * The page could only delete: rules were made with the CLI, the action —
 * the part that says what a rule actually does — was never rendered, and
 * the State column showed a pill nothing could flip.
 */

interface EdgeRuleRow {
  id: string;
  accountId: string;
  priority: number;
  kind: string;
  app: string;
  host: string;
  path: string;
  methods: string;
  /** The match condition in one line; empty when the rule has none. */
  condition: string;
  action: string;
  explanation: string;
  name: string;
  /** A log-mode rule is matched and counted but never acts. */
  logOnly: boolean;
  enabled: boolean;
}

/**
 * The rules table, scoped to one app or to the whole account.
 *
 * Rendered by this route without a slug, and as a tab on the app detail page
 * with one — the same split every other per-app resource uses, so the two can
 * never become two implementations.
 */
export function EdgeRulesBody({ slug: scoped }: { slug?: string }) {
  const { toast } = useToast();
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const cacheCapability = useCapability('declarative-response-caching');
  // Edge rules are a beta capability (faas productcap/catalog.json). With it
  // off, existing rules keep applying and stay readable; new ones are refused.
  const rulesCapability = useCapability('edge-rules');
  const rulesAccess = useCapabilityAccess('edge-rules').access;
  const rulesOff =
    rulesAccess === 'off' ||
    rulesAccess === 'plan-not-entitled' ||
    rulesAccess === 'runtime-unavailable';
  const cacheAllowed =
    Boolean(accountId) &&
    cacheCapability.accountId === accountId &&
    cacheCapability.state === 'available' &&
    account?.plan !== 'free';
  const writeIdentity = JSON.stringify([accountId, scoped, cacheAllowed]);
  const liveWrite = useRef({ identity: writeIdentity, epoch: 0 });
  useLayoutEffect(() => {
    if (liveWrite.current.identity !== writeIdentity)
      liveWrite.current = { identity: writeIdentity, epoch: liveWrite.current.epoch + 1 };
  }, [writeIdentity]);
  const confirm = useConfirm();
  const accountRules = useEdgeRules(!scoped, accountId);
  const appRules = useAppEdgeRules(scoped ?? '', accountId);
  const { data, isPending, error, refetch } = scoped ? appRules : accountRules;
  const { data: apps } = useApps(undefined, accountId);
  const deleteRule = useDeleteEdgeRule();
  const updateRule = useUpdateEdgeRule();

  const [editing, setEditing] = useState<EdgeRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [targetApp, setTargetApp] = useState<string | undefined>(undefined);
  // Rules, the CORS presets they reference, and the lists they share: three
  // views of one page rather than three panels stacked down it.
  const [view, setView] = useState<'rules' | 'presets' | 'lists'>('rules');
  const viewPanelId = useId();

  const rules = useMemo(
    () =>
      (data ?? [])
        .filter((rule) => accountId && rule.account_id === accountId)
        .sort((a, b) => a.priority - b.priority),
    [data, accountId]
  );
  const byId = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const nextPriority = rules.length ? Math.max(...rules.map((r) => r.priority)) + 10 : 10;
  const slug = scoped ?? targetApp ?? apps?.[0]?.slug ?? '';

  const rows = useMemo<EdgeRuleRow[]>(() => {
    const bySlug = slugIndex(apps ?? []);
    return rules.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      priority: r.priority,
      kind: r.kind,
      app: bySlug.get(r.app_id) ?? r.app_id,
      host: r.match_host || '*',
      path: r.match_path || '/*',
      methods: r.match_methods?.length ? r.match_methods.join(', ') : 'ANY',
      condition: summariseMatch(r.match),
      action: summarise(r.kind, ruleAction(r)),
      explanation: explainRule(r.kind, ruleAction(r), r.enabled, r.mode === 'log'),
      name: r.name ?? '',
      logOnly: r.mode === 'log',
      enabled: r.enabled,
    }));
  }, [rules, apps]);

  const canWriteRule = (r: EdgeRuleRow) =>
    r.accountId === accountId && (r.kind !== 'cache' || cacheAllowed);

  const setEnabled = (r: EdgeRuleRow, enabled: boolean) => {
    if (!canWriteRule(r)) return;
    void updateRule
      .mutateAsync({ id: r.id, enabled })
      .then(() => toast({ kind: 'success', title: enabled ? 'Rule enabled' : 'Rule paused' }))
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not update', error: err }));
  };

  /**
   * Priority is the evaluation order, so moving a rule means swapping its
   * number with its neighbour's — two PATCHes, no drag dependency.
   */
  const move = (r: EdgeRuleRow, direction: -1 | 1) => {
    const index = rules.findIndex((x) => x.id === r.id);
    const neighbour = rules[index + direction];
    if (!neighbour) return;
    const neighbourRow = rows.find((row) => row.id === neighbour.id);
    if (!canWriteRule(r) || !neighbourRow || !canWriteRule(neighbourRow)) return;
    void Promise.all([
      updateRule.mutateAsync({ id: r.id, priority: neighbour.priority }),
      updateRule.mutateAsync({ id: neighbour.id, priority: r.priority }),
    ])
      .then(() => toast({ kind: 'success', title: 'Order changed' }))
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not reorder', error: err }));
  };

  const columns: Column<EdgeRuleRow>[] = [
    {
      key: 'priority',
      label: '#',
      numeric: true,
      width: 'w-16',
      render: (r) => <span className="[font-variant-numeric:tabular-nums]">{r.priority}</span>,
    },
    {
      key: 'kind',
      label: 'Kind',
      width: 'w-32',
      render: (r) => (
        <span className="flex flex-col items-start gap-1">
          <Pill label={r.kind} />
          {r.logOnly && (
            <span
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
              style={{
                borderColor: 'color-mix(in oklab, var(--status-warning) 35%, transparent)',
                color: 'var(--status-warning)',
              }}
            >
              <Eye aria-hidden className="h-3 w-3" />
              log only
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'action',
      label: 'Rule and effect',
      render: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">
            {r.name || KINDS[r.kind as Kind]?.label || r.kind}
            {r.logOnly && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-status-warning">
                <Eye aria-hidden className="size-3" />
                log only
              </span>
            )}
          </span>
          <span className="mt-1 max-w-lg whitespace-normal text-xs leading-relaxed text-muted-foreground">
            {r.explanation}
          </span>
          <details
            className="mt-1 text-xs text-muted-foreground"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <summary className="w-fit cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-brand">
              Technical settings
            </summary>
            <span className="mt-1 block whitespace-normal font-mono">{r.action}</span>
          </details>
        </span>
      ),
    },
    {
      key: 'app',
      label: 'App',
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.app}</span>,
    },
    {
      key: 'host',
      label: 'Matches',
      render: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-xs">{r.host}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {r.path} · {r.methods}
          </span>
          {r.condition && (
            <span className="truncate font-mono text-xs text-muted-foreground">
              if {r.condition}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'enabled',
      label: 'Enabled',
      width: 'w-24',
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Switch
            size="sm"
            checked={r.enabled}
            onCheckedChange={(on) => setEnabled(r, on)}
            disabled={!canWriteRule(r)}
            aria-label={`${r.enabled ? 'Pause' : 'Enable'} rule ${r.priority}`}
            className="data-[state=checked]:bg-brand"
          />
        </span>
      ),
    },
  ];

  // The trailing controls, via the table's shielded actions cell — no
  // hand-written stopPropagation.
  const rowActionsFor = (r: EdgeRuleRow) => {
    const index = rules.findIndex((x) => x.id === r.id);
    const previous = rows[index - 1];
    const next = rows[index + 1];
    return (
      <>
        <button
          type="button"
          aria-label={`Move rule ${r.priority} earlier`}
          disabled={index === 0 || !canWriteRule(r) || !previous || !canWriteRule(previous)}
          onClick={() => move(r, -1)}
          className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Move rule ${r.priority} later`}
          disabled={index === rules.length - 1 || !canWriteRule(r) || !next || !canWriteRule(next)}
          onClick={() => move(r, 1)}
          className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Delete rule ${r.id}`}
          disabled={!canWriteRule(r)}
          onClick={async () => {
            if (!canWriteRule(r)) return;
            const writeEpoch = liveWrite.current.epoch;
            if (
              !(await confirm({
                title: 'Delete this edge rule?',
                description: `${r.kind} on ${r.host}${r.path} stops matching immediately.`,
                confirmLabel: 'Delete rule',
                destructive: true,
              }))
            )
              return;
            if (liveWrite.current.epoch !== writeEpoch || !canWriteRule(r)) return;
            void deleteRule
              .mutateAsync(r.id)
              .then(() => toast({ kind: 'success', title: 'Rule deleted' }))
              .catch((err: unknown) =>
                toast({
                  kind: 'error',
                  title: 'Could not delete',
                  error: err,
                })
              );
          }}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Trash className="h-3.5 w-3.5" />
        </button>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        label="Edge rule views"
        panelId={viewPanelId}
        value={view}
        options={[
          { key: 'rules', label: 'Rules' },
          { key: 'presets', label: 'CORS presets' },
          { key: 'lists', label: scoped ? 'History and lists' : 'Rule lists' },
        ]}
        onChange={setView}
      />
      <div
        role="tabpanel"
        id={viewPanelId}
        aria-labelledby={tabId(viewPanelId, view)}
        className="flex flex-col gap-4"
      >
        {view === 'rules' && (
          <>
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Edge rules decide what happens to a request before it reaches{' '}
              {scoped ? <span className="font-medium text-foreground">{scoped}</span> : 'an app'}.
              Use them to redirect visitors, require authentication, or return a maintenance
              message. Rules are evaluated in priority order.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="mr-auto flex flex-wrap items-center gap-2">
                <MaturityLabel capability={rulesCapability.capability} />
                {rulesOff && (
                  <span role="status" className="text-xs text-muted-foreground">
                    Edge rules are not enabled for this account. Existing rules keep applying.
                  </span>
                )}
              </div>
              {!scoped && (
                <label className="flex items-center gap-2">
                  <span className="label-mono text-muted-foreground">App</span>
                  <Select
                    value={slug}
                    onChange={(e) => setTargetApp(e.target.value)}
                    aria-label="App a new rule is created on"
                    className="bg-card"
                  >
                    {(apps ?? []).map((a) => (
                      <option key={a.slug} value={a.slug}>
                        {a.slug}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <Button
                size="sm"
                className="gap-1.5"
                disabled={!slug || rulesOff}
                onClick={() => {
                  setEditing(null);
                  setCreating(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add rule
              </Button>
            </div>

            {!cacheAllowed && rules.some((rule) => rule.kind === 'cache') && (
              <CapabilityNotice
                capability={cacheCapability.capability}
                state={cacheCapability.state}
                onRetry={cacheCapability.refresh}
              />
            )}

            <ResourceTable
              rows={rows}
              columns={columns.filter(
                (column) => column.key !== 'kind' && (!scoped || column.key !== 'app')
              )}
              initialSort={{ key: 'priority', dir: 'asc' }}
              searchKeys={['kind', 'name', 'host', 'path', 'app', 'action', 'condition']}
              searchPlaceholder="Filter by kind, host, or path…"
              emptyMessage="No edge rules yet. Add a rule to change how matching requests are handled."
              minWidth={scoped ? 'min-w-[760px]' : 'min-w-[900px]'}
              loading={isPending}
              error={error}
              onRetry={() => void refetch()}
              onRowClick={(r) => {
                const full = byId.get(r.id);
                if (full) setEditing(full);
              }}
              rowActions={rowActionsFor}
            />
          </>
        )}

        {view === 'presets' && <CorsPresetsPanel slug={scoped} />}
        {view === 'lists' && (
          <EdgeRulesExtras slug={scoped} rules={scoped ? (data ?? []) : rules} />
        )}
      </div>

      {(creating || editing) && (
        <EdgeRuleDialog
          // Remounts per rule so the draft reseeds without an effect.
          key={`${accountId}:${slug}:${editing?.id ?? 'new'}`}
          open
          rule={editing}
          slug={editing ? (rows.find((r) => r.id === editing.id)?.app ?? slug) : slug}
          apps={apps ?? []}
          nextPriority={nextPriority}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
