import { useMemo, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { CheckCircle, MinusCircle, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useUpdateApp, type App } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import { executionMode } from '@/lib/health-probes';
import {
  HOOK_DEFAULT_TIMEOUT_MS,
  HOOK_KEYS,
  HOOK_MAX_TIMEOUT_MS,
  hookChange,
  hookDraft,
  hookErrors,
  hooksApply,
  hooksYaml,
  type HookDraft,
  type HookKey,
} from '@/lib/snapshot-hooks';
import { GATE_MESSAGES } from './capability-gate';
import { MaturityLabel } from './maturity-label';
import { StatusTag } from './postgres-shared';
import { Panel } from './primitives';
import { ProblemHelp } from './problem-help';

/**
 * Snapshot lifecycle hooks (ledger C48, beta, catalog
 * `snapshot-lifecycle-hooks`): app code Gregale calls on loopback around a
 * snapshot, to close a database connection before one is taken and reopen it
 * after one is restored.
 *
 * Both are app settings `PATCH /v1/apps/{slug}` writes (faas
 * apidserver/lifecycle.go:265-278) and that imaged bakes into each deployment
 * (imaged/apply_overrides.go:220-229), so a saved hook applies from the next
 * deploy. Changing `before_checkpoint` discards the app's snapshots
 * (handlers_ext.go:1631). capgate refuses a hook while the capability is off
 * for the account (capgate/settings.go:74), so that state is read-only here.
 */

const CAPABILITY = 'snapshot-lifecycle-hooks';
type Hook = components['schemas']['AfterRestoreHook'];
type Drafts = Record<HookKey, HookDraft>;

const Code = ({ children }: { children: string }) => (
  <code className="whitespace-nowrap font-mono text-foreground">{children}</code>
);

const TITLES: Record<HookKey, string> = {
  after_restore: 'After restore',
  before_checkpoint: 'Before checkpoint',
};
const PLACEHOLDERS: Record<HookKey, string> = {
  after_restore: 'e.g. /internal/after-restore',
  before_checkpoint: 'e.g. /internal/before-checkpoint',
};
const LINES: Record<HookKey, ReactNode> = {
  after_restore: (
    <>
      POSTed with <Code>X-Faas-After-Restore: 1</Code> once a snapshot is restored or a frozen
      instance resumes, before it takes traffic; not on a cold boot. A 2xx lets the instance serve.
      A timeout or any other status discards it and the wake falls back to a cold boot, which the
      wake timeline shows as <Code>after_restore_failed</Code>.
    </>
  ),
  before_checkpoint: (
    <>
      POSTed with <Code>X-Faas-Before-Checkpoint: 1</Code> just before the VM is paused to capture a
      new init snapshot, not when an existing one is reused. A 2xx allows the capture. If it fails
      on the first capture the deployment fails with <Code>before_checkpoint_failed</Code>; on a
      later park no snapshot is kept and the instance stops. While it is set, warm snapshots are not
      captured, because a warm capture resumes the same guest.
    </>
  ),
};

const drafts = (app: App): Drafts => ({
  after_restore: hookDraft(app, 'after_restore'),
  before_checkpoint: hookDraft(app, 'before_checkpoint'),
});
const setHooks = (app: App) => HOOK_KEYS.filter((key) => app.manifest?.[key]?.path);
const timeoutLabel = (ms: number | undefined) =>
  ms ? `${ms} ms` : `${HOOK_DEFAULT_TIMEOUT_MS} ms (default)`;

function HookState({ on }: { on: boolean }) {
  return on ? (
    <StatusTag tone="good" icon={CheckCircle}>
      On
    </StatusTag>
  ) : (
    <StatusTag tone="muted" icon={MinusCircle}>
      Off
    </StatusTag>
  );
}

/** The hooks as saved, for a state that cannot edit them. */
function SavedHooks({ app }: { app: App }) {
  const keys = setHooks(app);
  if (!keys.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Hooks saved earlier still run with each deployment that carries them:
      </p>
      <dl className="flex flex-col gap-1.5 text-sm">
        {keys.map((key) => (
          <div key={key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <dt className="label-mono w-36 shrink-0 text-muted-foreground">{key}</dt>
            <dd className="flex flex-wrap gap-x-3 font-mono">
              <span>{app.manifest?.[key]?.path}</span>
              <span className="text-muted-foreground">
                {timeoutLabel(app.manifest?.[key]?.timeout_ms)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function HookFields({
  hookKey,
  draft,
  saved,
  errors,
  busy,
  onChange,
  onRemove,
}: {
  hookKey: HookKey;
  draft: HookDraft;
  saved: boolean;
  errors: { path?: string; timeout_ms?: string };
  busy: boolean;
  onChange: (next: HookDraft) => void;
  onRemove: () => void;
}) {
  const id = hookKey.replace('_', '-');
  const title = TITLES[hookKey];
  return (
    <fieldset aria-label={title} className="flex min-w-0 flex-col gap-3">
      <legend className="sr-only">{title}</legend>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          <code className="font-mono text-xs text-muted-foreground">{hookKey}</code>
          <HookState on={saved} />
        </p>
        {saved && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-path`} className="label-mono text-muted-foreground">
            Path
          </label>
          <input
            id={`${id}-path`}
            value={draft.path}
            placeholder={PLACEHOLDERS[hookKey]}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onChange({ ...draft, path: e.target.value })}
            {...fieldErrorProps(errors.path, `${id}-path-error`)}
            className={`${FIELD} w-full font-mono`}
          />
          {errors.path && <FieldError id={`${id}-path-error`}>{errors.path}</FieldError>}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-timeout`} className="label-mono text-muted-foreground">
            Timeout (ms)
          </label>
          <input
            id={`${id}-timeout`}
            type="number"
            min={0}
            max={HOOK_MAX_TIMEOUT_MS}
            inputMode="numeric"
            value={draft.timeout_ms}
            placeholder={`${HOOK_DEFAULT_TIMEOUT_MS} (default)`}
            onChange={(e) => onChange({ ...draft, timeout_ms: e.target.value })}
            {...fieldErrorProps(errors.timeout_ms, `${id}-timeout-error`)}
            className={`${FIELD} w-full [font-variant-numeric:tabular-nums]`}
          />
          {errors.timeout_ms && (
            <FieldError id={`${id}-timeout-error`}>{errors.timeout_ms}</FieldError>
          )}
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{LINES[hookKey]}</p>
    </fieldset>
  );
}

function removalCopy(app: App, keys: HookKey[]) {
  const path = (key: HookKey) => app.manifest?.[key]?.path ?? key;
  const lines = keys.map((key) =>
    key === 'after_restore'
      ? `Restored instances will take traffic without POST ${path(key)} first, so whatever it reopens stays as the snapshot left it.`
      : `New snapshots will be captured without POST ${path(key)} first, and this app’s existing snapshots are discarded, so the next wake cold-boots.`
  );
  return {
    title: keys.length === 1 ? `Remove the ${keys[0]} hook?` : 'Remove both snapshot hooks?',
    description: `${lines.join(' ')} This applies from the next deploy.`,
  };
}

function HookForm({ app, onNotReleased }: { app: App; onNotReleased: () => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const update = useUpdateApp(app.slug);
  const base = useMemo(() => drafts(app), [app]);
  const [draft, setDraft] = useState<Drafts>(base);
  const [failure, setFailure] = useState<unknown>(null);
  const saved = setHooks(app);

  const errors = {
    after_restore: hookErrors(draft.after_restore),
    before_checkpoint: hookErrors(draft.before_checkpoint),
  };
  const blocked = HOOK_KEYS.some((key) => Object.keys(errors[key]).length > 0);
  const changes = useMemo(() => {
    const out: Partial<Record<HookKey, Hook>> = {};
    for (const key of HOOK_KEYS) {
      const change = hookChange(base[key], draft[key]);
      if (change) out[key] = change;
    }
    return out;
  }, [base, draft]);
  const dirty = Object.keys(changes).length > 0;
  const yaml = hooksYaml(draft);
  const warmBlocked = Boolean(app.warm_snapshot_enabled && draft.before_checkpoint.path);

  const commit = async (body: Partial<Record<HookKey, Hook>>) => {
    if (update.isPending) return;
    // A cleared hook is `{}`; clearing one that was never set is not a removal.
    const removed = HOOK_KEYS.filter((key) => body[key] && !body[key].path && saved.includes(key));
    if (
      removed.length &&
      !(await confirm({
        ...removalCopy(app, removed),
        confirmLabel: removed.length > 1 ? 'Remove hooks' : 'Remove hook',
        destructive: true,
      }))
    )
      return;
    setFailure(null);
    try {
      const next = await update.mutateAsync(body);
      setDraft(drafts(next));
      toast({
        kind: 'success',
        title:
          removed.length && removed.length === Object.keys(body).length
            ? 'Hook removed'
            : 'Snapshot hooks saved',
        description: `Hooks are built into each deployment, so this applies from the next deploy.${
          'before_checkpoint' in body
            ? ' This app’s existing snapshots were discarded, so the next wake cold-boots.'
            : ''
        }`,
      });
    } catch (err) {
      setFailure(err);
      if (err instanceof ApiError && err.code === 'capability_not_released') onNotReleased();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {failure !== null && (
        <div className="flex flex-col gap-1">
          <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
            {errorMessage(failure)}
          </p>
          <ProblemHelp error={failure} />
        </div>
      )}
      {HOOK_KEYS.map((key) => (
        <HookFields
          key={key}
          hookKey={key}
          draft={draft[key]}
          saved={saved.includes(key)}
          errors={errors[key]}
          busy={update.isPending}
          onChange={(next) => setDraft((d) => ({ ...d, [key]: next }))}
          onRemove={() => void commit({ [key]: {} })}
        />
      ))}
      {warmBlocked && (
        <p
          role="note"
          className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed"
          style={{
            color: 'var(--status-warning)',
            borderColor: 'color-mix(in oklab, var(--status-warning) 35%, transparent)',
          }}
        >
          <WarningTriangle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Warm snapshots are on for this app, but none is captured while before_checkpoint is set.
            Wakes restore the init snapshot instead.
          </span>
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Both handlers must be idempotent, since a failed restore or capture is retried, and should
          check for a loopback peer and their header: Gregale strips <Code>x-faas-*</Code> headers
          from public requests. Timeouts default to {HOOK_DEFAULT_TIMEOUT_MS} ms and can be at most{' '}
          {HOOK_MAX_TIMEOUT_MS.toLocaleString('en-US')} ms; an after_restore hook adds its time to
          every wake. See{' '}
          <a
            href="/docs/scale-to-zero#refresh-application-state-after-restore"
            className="text-brand underline-offset-2 hover:underline"
          >
            Refresh application state after restore
          </a>
          .
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The <Code>lifecycle:</Code> block in gregale.yaml takes <Code>after_restore</Code> and{' '}
          <Code>before_checkpoint</Code>. A deploy whose gregale.yaml declares one replaces the hook
          saved here; a hook it leaves out keeps what is saved.
          {yaml ? ' What is set here, as gregale.yaml:' : ''}
        </p>
        {yaml && (
          <pre
            aria-label="gregale.yaml lifecycle hooks"
            className="overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed"
          >
            {yaml}
          </pre>
        )}
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!dirty || blocked}
          busy={update.isPending}
          onClick={() => void commit(changes)}
        >
          Save hooks
        </Button>
      </div>
    </div>
  );
}

export function SnapshotHooks({ app }: { app: App }) {
  const { access, capability, refresh } = useCapabilityAccess(CAPABILITY);
  const mode = executionMode(app);
  return (
    <Panel
      title="Snapshot hooks"
      help="App code Gregale calls on loopback before it captures a snapshot and after it restores one: to close a database connection and reopen it, say."
      actions={<MaturityLabel capability={capability} />}
    >
      {access !== 'on' ? (
        <div className="flex flex-col gap-4">
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
          >
            <span>{GATE_MESSAGES[access]}</span>
            {access === 'plan-not-entitled' && (
              <Link to="/dashboard/plans" className="text-brand underline">
                Compare plans
              </Link>
            )}
            {access === 'registry-error' && (
              <button type="button" className="text-brand underline" onClick={refresh}>
                Retry
              </button>
            )}
          </div>
          {access !== 'loading' && <SavedHooks app={app} />}
        </div>
      ) : !hooksApply(app) ? (
        <p className="text-sm text-muted-foreground">
          Snapshot hooks apply to request and service apps, which are snapshotted when they park.
          This app runs in {mode} mode, so there is nothing to hook.
        </p>
      ) : (
        <HookForm app={app} onNotReleased={refresh} />
      )}
    </Panel>
  );
}
