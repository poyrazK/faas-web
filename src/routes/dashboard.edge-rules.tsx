import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { EdgeRuleDialog } from '@/components/dashboard/edge-rules/dialog';
import { summarise } from '@/components/dashboard/edge-rules/kinds';
import {
  useAppEdgeRules,
  useApps,
  useDeleteEdgeRule,
  useEdgeRules,
  useUpdateEdgeRule,
  type EdgeRule,
} from '@/lib/api/queries';
import { slugIndex } from '@/lib/api/adapters';
import { errorMessage } from '@/lib/api/errors';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/edge-rules')({
  component: EdgeRulesPage,
  head: () => consoleHead('edge-rules'),
});

/**
 * Rules the gateway applies before a request reaches an app.
 *
 * The page could only delete: rules were made with the CLI, the action —
 * the part that says what a rule actually does — was never rendered, and
 * the State column showed a pill nothing could flip.
 */

interface EdgeRuleRow {
  id: string;
  priority: number;
  kind: string;
  app: string;
  host: string;
  path: string;
  methods: string;
  action: string;
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
  const confirm = useConfirm();
  const accountRules = useEdgeRules(!scoped);
  const appRules = useAppEdgeRules(scoped ?? '');
  const { data, isPending, error, refetch } = scoped ? appRules : accountRules;
  const { data: apps } = useApps();
  const deleteRule = useDeleteEdgeRule();
  const updateRule = useUpdateEdgeRule();

  const [editing, setEditing] = useState<EdgeRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [targetApp, setTargetApp] = useState<string | undefined>(undefined);

  const rules = useMemo(() => [...(data ?? [])].sort((a, b) => a.priority - b.priority), [data]);
  const byId = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const nextPriority = rules.length ? Math.max(...rules.map((r) => r.priority)) + 10 : 10;
  const slug = scoped ?? targetApp ?? apps?.[0]?.slug ?? '';

  const rows = useMemo<EdgeRuleRow[]>(() => {
    const bySlug = slugIndex(apps ?? []);
    return rules.map((r) => ({
      id: r.id,
      priority: r.priority,
      kind: r.kind,
      app: bySlug.get(r.app_id) ?? r.app_id,
      host: r.match_host || '*',
      path: r.match_path || '/*',
      methods: r.match_methods?.length ? r.match_methods.join(', ') : 'ANY',
      action: summarise(r.kind, r.action),
      enabled: r.enabled,
    }));
  }, [rules, apps]);

  const setEnabled = (r: EdgeRuleRow, enabled: boolean) =>
    void updateRule
      .mutateAsync({ id: r.id, enabled })
      .then(() => toast({ kind: 'success', title: enabled ? 'Rule enabled' : 'Rule paused' }))
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not update', description: errorMessage(err) })
      );

  /**
   * Priority is the evaluation order, so moving a rule means swapping its
   * number with its neighbour's — two PATCHes, no drag dependency.
   */
  const move = (r: EdgeRuleRow, direction: -1 | 1) => {
    const index = rules.findIndex((x) => x.id === r.id);
    const neighbour = rules[index + direction];
    if (!neighbour) return;
    void Promise.all([
      updateRule.mutateAsync({ id: r.id, priority: neighbour.priority }),
      updateRule.mutateAsync({ id: neighbour.id, priority: r.priority }),
    ])
      .then(() => toast({ kind: 'success', title: 'Order changed' }))
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not reorder', description: errorMessage(err) })
      );
  };

  const columns: Column<EdgeRuleRow>[] = [
    {
      key: 'priority',
      label: '#',
      numeric: true,
      width: 'w-16',
      render: (r) => <span className="[font-variant-numeric:tabular-nums]">{r.priority}</span>,
    },
    { key: 'kind', label: 'Kind', width: 'w-32', render: (r) => <Pill label={r.kind} /> },
    {
      key: 'action',
      label: 'Does',
      render: (r) => <span className="font-mono text-xs">{r.action}</span>,
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
    return (
      <>
        <button
          type="button"
          aria-label={`Move rule ${r.priority} earlier`}
          disabled={index === 0}
          onClick={() => move(r, -1)}
          className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Move rule ${r.priority} later`}
          disabled={index === rules.length - 1}
          onClick={() => move(r, 1)}
          className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Delete rule ${r.id}`}
          onClick={async () => {
            if (
              !(await confirm({
                title: 'Delete this edge rule?',
                description: `${r.kind} on ${r.host}${r.path} stops matching immediately.`,
                confirmLabel: 'Delete rule',
                destructive: true,
              }))
            )
              return;
            void deleteRule
              .mutateAsync(r.id)
              .then(() => toast({ kind: 'success', title: 'Rule deleted' }))
              .catch((err: unknown) =>
                toast({
                  kind: 'error',
                  title: 'Could not delete',
                  description: errorMessage(err),
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!scoped && (
          <label className="flex items-center gap-2">
            <span className="label-mono text-muted-foreground">App</span>
            <select
              value={slug}
              onChange={(e) => setTargetApp(e.target.value)}
              aria-label="App a new rule is created on"
              className="h-9 rounded-md border border-border bg-card px-2.5 text-sm outline-none focus:border-brand/50"
            >
              {(apps ?? []).map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.slug}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          size="sm"
          className="gap-1.5"
          disabled={!slug}
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add rule
        </Button>
      </div>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'priority', dir: 'asc' }}
        searchKeys={['kind', 'host', 'path', 'app', 'action']}
        searchPlaceholder="Filter by kind, host, or path…"
        emptyMessage="No edge rules yet."
        minWidth="min-w-[980px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        onRowClick={(r) => {
          const full = byId.get(r.id);
          if (full) setEditing(full);
        }}
        rowActions={rowActionsFor}
      />

      {(creating || editing) && (
        <EdgeRuleDialog
          // Remounts per rule so the draft reseeds without an effect.
          key={editing?.id ?? 'new'}
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

function EdgeRulesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Edge Rules"
        description="Applied at the gateway, in priority order, before a request reaches an app."
      />
      <EdgeRulesBody />
    </div>
  );
}
