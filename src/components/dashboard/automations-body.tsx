import { useState } from 'react';
import { Pause, Play, Plus, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { AppScope, AppSelect, useSelectedApp } from './app-select';
import { InlinePhase, Panel, queryPhase, StatTile } from './primitives';
import { ResourceTable, type Column } from './resource-table';
import { AutomationEditor, JsonField, JsonReadout } from './automation-editor';
import { AutomationStatus, Pagination } from './automation-primitives';
import { AutomationRuns } from './automation-runs';
import { availabilityMessage, jsonValue } from './automation-definition';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api/errors';
import {
  useAutomations,
  useAutomationHealth,
  useAutomationRevisions,
  useWriteAutomation,
  useStartAutomationRun,
  type Automation,
} from '@/lib/api/automations';
import type { JobsSelectionProps } from './jobs-search';

function LastRun({
  account,
  slug,
  name,
  onOpen,
}: {
  account: string;
  slug: string;
  name: string;
  onOpen: (id: string) => void;
}) {
  const q = useAutomationHealth(account, slug, name);
  if (q.isPending) return <span className="text-xs text-muted-foreground">Loading…</span>;
  if (q.error)
    return (
      <button
        type="button"
        className="text-xs text-muted-foreground underline"
        onClick={() => void q.refetch()}
        title={errorMessage(q.error)}
      >
        Unavailable · retry
      </button>
    );
  return q.data?.last_run ? (
    <button
      type="button"
      onClick={() => onOpen(q.data!.last_run!.id)}
      className="flex flex-col items-start gap-1 text-left"
    >
      <AutomationStatus status={q.data.last_run.status} />
      <time className="text-xs text-muted-foreground" dateTime={q.data.last_run.created_at}>
        {new Date(q.data.last_run.created_at).toLocaleString()}
      </time>
    </button>
  ) : (
    <span className="text-xs text-muted-foreground">No runs</span>
  );
}

export function AutomationsBody({
  search,
  onSelection,
  fixedSlug,
}: JobsSelectionProps & { fixedSlug?: string }) {
  const state = useSelectedApp();
  const requested = fixedSlug ?? search.app;
  const slug = requested ?? state.slug;
  const { account } = useAuth();
  const unavailableApp =
    !fixedSlug && Boolean(requested && !state.apps.some((app) => app.slug === requested));
  return (
    <div className="flex flex-col gap-5">
      {!fixedSlug && (
        <AppSelect
          slug={unavailableApp ? '' : slug}
          apps={state.apps}
          onSelect={(app) =>
            onSelection({
              app,
              automation: undefined,
              automationRun: undefined,
              automationView: undefined,
              automationNew: undefined,
            })
          }
        />
      )}
      <AppScope state={state} resource="automations">
        {unavailableApp ? (
          <Panel title="App unavailable">
            <p className="text-sm text-muted-foreground">
              The app in this link is not in your accessible app list. Select an app to continue.
            </p>
          </Panel>
        ) : account ? (
          <AppAutomations
            key={slug}
            account={account.id}
            slug={slug}
            appId={state.apps.find((app) => app.slug === slug)?.id ?? ''}
            search={search}
            onSelection={onSelection}
          />
        ) : (
          <InlinePhase phase="loading" loadingMessage="Loading account…" />
        )}
      </AppScope>
    </div>
  );
}

function AppAutomations({
  account,
  slug,
  appId,
  search,
  onSelection,
}: JobsSelectionProps & { account: string; slug: string; appId: string }) {
  const q = useAutomations(account, slug);
  const [reloadKey, setReloadKey] = useState(0);
  const phase = queryPhase({ loading: q.isPending, error: q.error });
  const rows = (q.data?.automations ?? []).map((automation) => ({
    ...automation,
    id: automation.name,
    trigger: automation.published?.trigger?.type ?? automation.draft.trigger?.type ?? 'manual',
    publication: automation.published ? 'published' : 'draft',
  }));
  const selected = q.data?.automations.find((automation) => automation.name === search.automation);
  const isNew = search.automationNew === true;
  const blocked = q.data
    ? availabilityMessage(q.data.runtime_enabled, q.data.unavailable_reason)
    : undefined;
  const atLimit = Boolean(q.data && rows.length >= q.data.max_definitions);
  const select = (name: string, view?: 'editor' | 'runs' | 'revisions', run?: string) =>
    onSelection({
      automation: name,
      automationView: view,
      automationRun: run,
      automationNew: undefined,
    });
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    {
      key: 'name',
      label: 'Automation',
      render: (row) => (
        <button
          type="button"
          className="font-mono text-sm text-brand hover:underline"
          onClick={() => select(row.name)}
        >
          {row.name}
        </button>
      ),
    },
    {
      key: 'trigger',
      label: 'Trigger',
      render: (row) => <span className="text-sm capitalize">{row.trigger}</span>,
    },
    {
      key: 'publication',
      label: 'Publication',
      render: (row) => (
        <div className="flex flex-col gap-1">
          <AutomationStatus status={row.publication} />
          <span className="text-xs text-muted-foreground">
            {row.published_version === undefined
              ? row.source === 'manifest'
                ? 'Manifest owned'
                : `Draft revision ${row.version}`
              : `Published revision ${row.published_version}`}
          </span>
        </div>
      ),
    },
    {
      key: 'enabled',
      label: 'Automatic starts',
      render: (row) =>
        row.trigger === 'manual' ? (
          <span className="text-xs text-muted-foreground">Manual only</span>
        ) : (
          <AutomationStatus status={row.enabled ? 'enabled' : 'paused'} />
        ),
    },
    {
      key: 'updated_at',
      label: 'Last run',
      sortable: false,
      render: (row) => (
        <LastRun
          account={account}
          slug={slug}
          name={row.name}
          onOpen={(id) => select(row.name, 'runs', id)}
        />
      ),
    },
  ];
  return (
    <>
      <Panel
        title="Automations"
        description="Connect app handlers into durable steps, with dependencies, retries, and waits."
        actions={
          <Button
            size="sm"
            disabled={phase !== 'ready' || atLimit}
            onClick={() =>
              onSelection({
                automation: undefined,
                automationView: undefined,
                automationRun: undefined,
                automationNew: true,
              })
            }
          >
            <Plus className="h-4 w-4" />
            New automation
          </Button>
        }
      >
        {blocked && (
          <div
            className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground"
            role="status"
          >
            <WarningTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{blocked} Draft editing, validation, and simulation remain available.</p>
          </div>
        )}
        {q.data && (
          <p className="mb-4 text-xs text-muted-foreground">
            {rows.length} of {q.data.max_definitions} definitions used · Automations preview
            {atLimit ? ' · Definition limit reached' : ''}
          </p>
        )}
        <ResourceTable
          rows={rows}
          columns={columns}
          searchKeys={['name', 'trigger']}
          searchPlaceholder="Find an automation…"
          minWidth="min-w-[680px]"
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          emptyMessage="No automations for this app yet. Create a draft to connect its handlers."
        />
      </Panel>
      {phase === 'ready' && isNew && !atLimit && (
        <AutomationEditor
          key={`new-${reloadKey}`}
          account={account}
          slug={slug}
          onClose={() => onSelection({ automationNew: undefined })}
          onSaved={(next) => select(next.name)}
          onReload={() => {
            setReloadKey((key) => key + 1);
          }}
        />
      )}
      {phase === 'ready' && search.automation && !isNew && !selected && (
        <Panel title="Automation unavailable">
          <p className="text-sm text-muted-foreground">
            This definition is no longer in the app inventory.
          </p>
        </Panel>
      )}
      {phase === 'ready' && selected && (
        <AutomationWorkspace
          key={selected.name}
          account={account}
          slug={slug}
          appId={appId}
          automation={selected}
          blocked={blocked}
          search={search}
          onSelection={onSelection}
          reloadKey={reloadKey}
          onReload={() => {
            void q.refetch().then((result) => {
              if (!result.error) setReloadKey((key) => key + 1);
            });
          }}
        />
      )}
    </>
  );
}

function AutomationWorkspace({
  account,
  slug,
  appId,
  automation,
  blocked,
  search,
  onSelection,
  reloadKey,
  onReload,
}: JobsSelectionProps & {
  account: string;
  slug: string;
  appId: string;
  automation: Automation;
  blocked?: string;
  reloadKey: number;
  onReload: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const write = useWriteAutomation(account, slug);
  const health = useAutomationHealth(account, slug, automation.name);
  const [runOpen, setRunOpen] = useState(false);
  const view = search.automationView ?? 'editor';
  const trigger = automation.published?.trigger?.type ?? 'manual';
  const toggle = async () => {
    if (
      !(await confirm({
        title: `${automation.enabled ? 'Pause' : 'Resume'} automatic starts?`,
        description: automation.enabled
          ? 'Future scheduled and event starts will pause. Accepted events and existing runs continue.'
          : 'Future scheduled and event starts will resume.',
        confirmLabel: automation.enabled ? 'Pause starts' : 'Resume starts',
      }))
    )
      return;
    try {
      await write.mutateAsync({
        kind: 'enabled',
        name: automation.name,
        body: { expected_version: automation.version, enabled: !automation.enabled },
      });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Could not change automatic starts',
        description: errorMessage(err),
      });
    }
  };
  return (
    <>
      <Panel
        title={automation.name}
        description={`${slug} · ${automation.source === 'manifest' ? 'Manifest owned' : 'API owned'} · Saved revision ${automation.version}`}
        actions={
          <>
            {automation.published && trigger !== 'manual' && (
              <Button
                size="sm"
                variant="outline"
                busy={write.isPending}
                onClick={() => void toggle()}
              >
                {automation.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {automation.enabled ? 'Pause starts' : 'Resume starts'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!automation.published || Boolean(blocked)}
              title={blocked ?? (!automation.published ? 'Publish a draft first' : undefined)}
              onClick={() => setRunOpen(true)}
            >
              <Play className="h-4 w-4" />
              Run now
            </Button>
          </>
        }
      >
        <InlinePhase
          phase={queryPhase({ error: health.error, loading: health.isPending })}
          error={health.error}
          loadingMessage="Loading automation health…"
          onRetry={() => void health.refetch()}
        />
        {health.data && !health.error && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <StatTile label="Runs · last 7 days" value={health.data.run_count} />
              <StatTile
                label="Success rate"
                value={
                  health.data.completed_run_count
                    ? `${(health.data.success_rate * 100).toFixed(1)}%`
                    : 'No completed runs'
                }
              />
              <StatTile label="Active now" value={health.data.active_run_count} />
              <StatTile label="Queued now" value={health.data.queued_run_count} />
            </div>
            {health.data.failed_steps.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Frequently failed steps:{' '}
                {health.data.failed_steps
                  .map((step) => `${step.step_name} (${step.failed_run_count})`)
                  .join(', ')}
              </p>
            )}
          </>
        )}
        <nav
          aria-label="Automation views"
          className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4"
        >
          {(['editor', 'runs', 'revisions'] as const).map((next) => (
            <Button
              key={next}
              size="sm"
              variant={view === next ? 'secondary' : 'ghost'}
              aria-current={view === next ? 'page' : undefined}
              onClick={() => onSelection({ automationView: next })}
            >
              {next === 'editor'
                ? 'Definition'
                : next === 'runs'
                  ? 'Run history'
                  : 'Published revisions'}
            </Button>
          ))}
        </nav>
      </Panel>
      {view === 'editor' && (
        <AutomationEditor
          key={`${automation.name}-${reloadKey}`}
          account={account}
          slug={slug}
          automation={automation}
          onSaved={() => {}}
          onReload={onReload}
        />
      )}
      {view === 'runs' && (
        <AutomationRuns
          account={account}
          slug={slug}
          appId={appId}
          name={automation.name}
          selectedId={search.automationRun}
          onSelect={(automationRun) => onSelection({ automationRun })}
        />
      )}
      {view === 'revisions' && (
        <RevisionHistory
          account={account}
          slug={slug}
          automation={automation}
          onRestored={() => {
            onReload();
            onSelection({ automationView: 'editor' });
          }}
        />
      )}
      {runOpen && (
        <RunAutomationDialog
          account={account}
          slug={slug}
          name={automation.name}
          onClose={() => setRunOpen(false)}
          onStarted={(id) => {
            setRunOpen(false);
            onSelection({ automationView: 'runs', automationRun: id });
          }}
        />
      )}
    </>
  );
}

function RevisionHistory({
  account,
  slug,
  automation,
  onRestored,
}: {
  account: string;
  slug: string;
  automation: Automation;
  onRestored: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const q = useAutomationRevisions(account, slug, automation.name, offset);
  const write = useWriteAutomation(account, slug);
  const confirm = useConfirm();
  const [error, setError] = useState('');
  return (
    <Panel
      title="Published revisions"
      description="Immutable publications. Restoring creates a draft; publish it separately to change future runs."
    >
      <InlinePhase
        phase={queryPhase({
          loading: q.isPending,
          error: q.error,
          isEmpty: q.data?.revisions.length === 0,
        })}
        error={q.error}
        emptyMessage="No retained publications. Manifest-only definitions do not have API publication history."
        onRetry={() => void q.refetch()}
      />
      <div className="flex flex-col gap-3">
        {!q.error &&
          q.data?.revisions.map((revision) => (
            <details key={revision.version} className="rounded-lg border border-border p-4">
              <summary className="cursor-pointer text-sm">
                Revision {revision.version} · {new Date(revision.recorded_at).toLocaleString()}
                {revision.legacy_snapshot && ' · Legacy snapshot'}
              </summary>
              <div className="mt-4 flex flex-col gap-3">
                <p className="break-all font-mono text-xs text-muted-foreground">
                  SHA-256: {revision.definition_hash}
                </p>
                <p className="break-all text-xs text-muted-foreground">
                  Published by account {revision.published_by_account_id}
                  {revision.published_by_api_key_id &&
                    ` · API key ${revision.published_by_api_key_id}`}
                </p>
                <JsonReadout value={revision.definition} />
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  busy={write.isPending}
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: `Restore revision ${revision.version} to draft?`,
                        description: `This replaces the saved draft using current revision ${automation.version}. The published definition and existing runs keep their current state.`,
                        confirmLabel: 'Restore draft',
                      }))
                    )
                      return;
                    setError('');
                    try {
                      await write.mutateAsync({
                        kind: 'restore',
                        name: automation.name,
                        version: revision.version,
                        body: { expected_version: automation.version },
                      });
                      onRestored();
                    } catch (err) {
                      setError(errorMessage(err));
                    }
                  }}
                >
                  Restore to draft
                </Button>
              </div>
            </details>
          ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}
      <Pagination
        offset={offset}
        total={q.data?.total ?? 0}
        busy={q.isPending}
        onChange={setOffset}
      />
    </Panel>
  );
}

function RunAutomationDialog({
  account,
  slug,
  name,
  onClose,
  onStarted,
}: {
  account: string;
  slug: string;
  name: string;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const [input, setInput] = useState('{}');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const start = useStartAutomationRun(account, slug, name);
  return (
    <Modal
      open
      title={`Run ${name}`}
      description={`This starts a real run against ${slug}, using its published definition. App handlers can have side effects.`}
      onClose={() => {
        if (!start.isPending) onClose();
      }}
      footer={
        <>
          <Button size="sm" variant="ghost" disabled={start.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            busy={start.isPending}
            onClick={async () => {
              setError('');
              try {
                const result = await start.mutateAsync({
                  input: jsonValue(input, 'Run input'),
                  key,
                });
                onStarted(result.id);
              } catch (err) {
                setError(
                  `${errorMessage(err)} If the response was lost, submitting the same input again uses the same request key.`
                );
              }
            }}
          >
            Start real run
          </Button>
        </>
      }
    >
      <JsonField
        label="Run input (JSON)"
        value={input}
        onChange={(value) => {
          setInput(value);
          setKey(crypto.randomUUID());
          setError('');
        }}
      />
      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}
    </Modal>
  );
}
