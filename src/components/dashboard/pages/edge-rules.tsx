import { CapabilityNotice } from '@/components/dashboard/capability-notice';
import { CorsPresetsPanel } from '@/components/dashboard/cors-presets';
import { EdgeRuleDialog } from '@/components/dashboard/edge-rules/dialog';
import { EdgeRulesExtras } from '@/components/dashboard/edge-rules/edge-rules-extras';
import { RuleSummary } from '@/components/dashboard/edge-rules/rule-summary';
import { explainRule, ruleScope } from '@/components/dashboard/edge-rules/explain';
import { summarise } from '@/components/dashboard/edge-rules/kinds';
import { MaturityLabel } from '@/components/dashboard/maturity-label';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
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
  useCorsPresets,
  useDeleteEdgeRule,
  useEdgeRules,
  useUpdateEdgeRule,
  type EdgeRule,
} from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { summariseMatch } from '@/lib/edge-rule-match';
import { inScope, useProjectScope } from '@/lib/project-scope';
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
  emphasis: string[];
  scope: string;
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
  const wafAccess = useCapabilityAccess('edge-waf-blocking').access;
  const wafBlocking =
    wafAccess === 'loading' || wafAccess === 'registry-error' ? undefined : wafAccess === 'on';
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
  const appsQuery = useApps(undefined, accountId);
  // On the account page inside a project, only rules on the project's apps,
  // and new rules only on them. A rule names its app by id, so the apps must
  // be known before a rule can be placed; until then (and until membership
  // loads) the table keeps loading rather than flash every rule.
  const scope = useProjectScope();
  const projectScoped = !scoped && Boolean(scope.project);
  const scopeLoading =
    projectScoped && ((scope.appSlugs === null && !scope.settled) || appsQuery.isPending);
  const apps = useMemo(
    () =>
      appsQuery.data && (scoped ? appsQuery.data : inScope(appsQuery.data, scope, (a) => a.slug)),
    [appsQuery.data, scoped, scope]
  );
  // The unfiltered endpoint includes account-wide policies referenced by app rules.
  const corsPresets = useCorsPresets();
  const deleteRule = useDeleteEdgeRule();
  const updateRule = useUpdateEdgeRule();

  const [editing, setEditing] = useState<EdgeRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [targetApp, setTargetApp] = useState<string | undefined>(undefined);
  // Rules, the CORS presets they reference, and the lists they share: three
  // views of one page rather than three panels stacked down it.
  const [view, setView] = useState<'rules' | 'presets' | 'lists'>('rules');
  const viewPanelId = useId();

  const ownRules = useMemo(
    () =>
      (data ?? [])
        .filter((rule) => accountId && rule.account_id === accountId)
        .sort((a, b) => a.priority - b.priority),
    [data, accountId]
  );
  const rules = useMemo(() => {
    if (scoped) return ownRules;
    const bySlug = slugIndex(appsQuery.data ?? []);
    return inScope(ownRules, scope, (rule) => bySlug.get(rule.app_id) ?? '');
  }, [ownRules, scoped, appsQuery.data, scope]);
  const byId = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const nextPriority = ownRules.length ? Math.max(...ownRules.map((r) => r.priority)) + 10 : 10;
  // A pick from another project no longer counts once the project changes.
  const slug =
    scoped ??
    (targetApp && apps?.some((a) => a.slug === targetApp) ? targetApp : apps?.[0]?.slug) ??
    '';

  const rows = useMemo<EdgeRuleRow[]>(() => {
    const bySlug = slugIndex(appsQuery.data ?? []);
    return rules.map((r) => {
      const emphasis: string[] = [];
      return {
        id: r.id,
        accountId: r.account_id,
        priority: r.priority,
        kind: r.kind,
        app: scoped ?? bySlug.get(r.app_id) ?? r.app_id,
        host: r.match_host || '*',
        path: r.match_path || '/*',
        methods: r.match_methods?.length ? r.match_methods.join(', ') : 'ANY',
        condition: summariseMatch(r.match),
        action: summarise(r.kind, ruleAction(r)),
        emphasis,
        explanation: explainRule(r, scoped ?? bySlug.get(r.app_id) ?? r.app_id, {
          wafBlocking,
          onEmphasis: (text) => emphasis.push(text),
          corsPreset:
            !corsPresets.error && !corsPresets.isPending
              ? corsPresets.data?.presets.find(
                  (preset) =>
                    preset.id ===
                    (ruleAction(r) as { cors_preset_id?: string } | undefined)?.cors_preset_id
                )
              : undefined,
        }),
        scope: ruleScope(r, scoped ?? bySlug.get(r.app_id) ?? r.app_id),
        name: r.name ?? '',
        logOnly: r.mode === 'log',
        enabled: r.enabled,
      };
    });
  }, [
    rules,
    appsQuery.data,
    scoped,
    wafBlocking,
    corsPresets.data,
    corsPresets.error,
    corsPresets.isPending,
  ]);

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
      key: 'explanation',
      label: 'Rule',
      render: (r) => (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => {
            const full = byId.get(r.id);
            if (full) setEditing(full);
          }}
          className="flex w-full min-w-0 cursor-pointer flex-col gap-1 rounded-sm py-2 text-left whitespace-normal outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]"
        >
          <span className="text-sm font-medium leading-relaxed text-foreground">
            <RuleSummary text={r.explanation} emphasis={r.emphasis} />
          </span>
          {r.scope && (
            <span className="text-xs leading-relaxed text-muted-foreground">{r.scope}</span>
          )}
          {(r.name || r.logOnly) && (
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {r.name && <span>{r.name}</span>}
              {r.logOnly && (
                <span className="inline-flex items-center gap-1 text-status-warning">
                  <Eye aria-hidden className="size-3" />
                  log only
                </span>
              )}
            </span>
          )}
        </button>
      ),
    },
    {
      key: 'app',
      label: 'App',
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.app}</span>,
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
              Rules run in priority order. Open a rule to change its conditions and settings.
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
                disabled={!slug || rulesOff || isPending || scopeLoading || Boolean(error)}
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
              columns={columns.filter((column) => !scoped || column.key !== 'app')}
              initialSort={{ key: 'priority', dir: 'asc' }}
              searchKeys={[
                'kind',
                'name',
                'host',
                'path',
                'app',
                'action',
                'condition',
                'explanation',
                'scope',
              ]}
              searchPlaceholder="Find a rule by what it does…"
              emptyMessage={
                projectScoped
                  ? `No edge rules on ${scope.label} apps yet. Add a rule to change how matching requests are handled.`
                  : 'No edge rules yet. Add a rule to change how matching requests are handled.'
              }
              minWidth={scoped ? 'min-w-[560px]' : 'min-w-[720px]'}
              loading={isPending || scopeLoading}
              error={error}
              onRetry={() => void refetch()}
              rowActions={rowActionsFor}
            />
          </>
        )}

        {projectScoped && view !== 'rules' && (
          <p className="text-xs text-muted-foreground">
            Account-wide — not limited to {scope.label}.
          </p>
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
