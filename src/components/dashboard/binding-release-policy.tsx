import { useId, useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { useCapability } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  QUEUE_BINDING_NAME,
  REASON_MAX_BYTES,
  REQUIREMENTS_MAX,
  SCOPE_PATTERN,
  STORAGE_PREFIX,
  parseVerificationAge,
  useReleasePolicy,
  useSetReleasePolicy,
  type PolicyForm,
  type ReleasePolicy,
} from '@/lib/api/binding-verification';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldError, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from './primitives';

const QUEUE_EVIDENCE: Record<string, string> = {
  consumer_readiness: 'Consumer readiness',
  handler_completion: 'Handler completion',
};
const STORAGE_MODES: Record<string, string> = {
  read: 'Read',
  write: 'Write',
  read_write: 'Read and write',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The stored binding release policy for one deployment scope (faas ADR-598,
 * handlers_binding_release_policy.go). Enforcement fences every traffic
 * increase in the scope; the policy itself never runs a probe.
 */
export function BindingReleasePolicy({ slug }: { slug: string }) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const [scope, setScope] = useState('default');
  const [draftScope, setDraftScope] = useState('default');
  const [scopeError, setScopeError] = useState('');
  const [editing, setEditing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const policy = useReleasePolicy(accountId, slug, scope);
  const phase = queryPhase({ error: policy.error, loading: policy.isLoading });
  const scopeErrorId = useId();

  function applyScope(event: FormEvent) {
    event.preventDefault();
    const next = draftScope.trim();
    if (!SCOPE_PATTERN.test(next)) {
      setScopeError('Lowercase letters, digits and inner hyphens, up to 40 characters.');
      return;
    }
    setScopeError('');
    setEditing(false);
    setConflict(false);
    setScope(next);
  }

  return (
    <Panel
      title="Binding release policy"
      description="Applies to every traffic increase in one deployment scope. When enforced, promotion, traffic changes and canary advances are refused (bindings_release_required) until the deployment gaining traffic has fresh binding evidence. Saving a policy does not change serving traffic and runs no probes."
    >
      <div className="space-y-4 text-sm">
        <form onSubmit={applyScope} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Deployment scope</span>
            <Input
              aria-label="Deployment scope"
              value={draftScope}
              onChange={(e) => setDraftScope(e.target.value)}
              className="w-48 font-mono"
              aria-invalid={scopeError ? true : undefined}
              aria-describedby={scopeError ? scopeErrorId : undefined}
            />
          </label>
          <Button type="submit" variant="outline" size="sm">
            Show scope
          </Button>
          {scopeError && <FieldError id={scopeErrorId}>{scopeError}</FieldError>}
        </form>
        <InlinePhase
          phase={phase}
          error={policy.error}
          loadingMessage="Loading release policy…"
          onRetry={() => void policy.refetch()}
        />
        {conflict && (
          <p role="alert" style={{ color: 'var(--status-warning)' }}>
            The policy changed since you opened it. The current revision is shown; review it and
            edit again.
          </p>
        )}
        {phase === 'ready' &&
          policy.data &&
          (editing ? (
            <PolicyEditor
              key={`${scope}:${policy.data.revision}`}
              slug={slug}
              scope={scope}
              current={policy.data}
              onDone={(outcome) => {
                setEditing(false);
                setConflict(outcome === 'conflict');
              }}
            />
          ) : (
            <>
              <PolicySummary policy={policy.data} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setConflict(false);
                  setEditing(true);
                }}
              >
                Edit policy
              </Button>
            </>
          ))}
      </div>
    </Panel>
  );
}

function PolicySummary({ policy }: { policy: ReleasePolicy }) {
  const queue = Object.entries(policy.queue_requirements ?? {});
  const storage = Object.entries(policy.object_storage_requirements ?? {});
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={policy.mode === 'enforce' ? 'default' : 'outline'}>
          {policy.mode === 'enforce' ? 'Enforced' : 'Off'}
        </Badge>
        <span className="text-xs text-muted-foreground tabular-nums">
          Revision {policy.revision}
        </span>
        {policy.updated_at && (
          <span className="text-xs text-muted-foreground">· updated {when(policy.updated_at)}</span>
        )}
      </div>
      {policy.revision === 0 && (
        <p className="text-muted-foreground">
          This scope has never had a policy, so it is off by default.
        </p>
      )}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">Maximum evidence age</dt>
        <dd className="font-mono">{policy.max_verification_age}</dd>
        <dt className="text-muted-foreground">Application acknowledgements</dt>
        <dd>{policy.require_application_ack ? 'Required' : 'Not required'}</dd>
        <dt className="text-muted-foreground">Queue requirements</dt>
        <dd>
          {queue.length ? (
            <ul className="space-y-1">
              {queue.map(([name, evidence]) => (
                <li key={name} className="flex flex-wrap gap-2">
                  <span className="font-mono">{name}</span>
                  <span className="text-muted-foreground">
                    {QUEUE_EVIDENCE[evidence] ?? evidence}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            'None'
          )}
        </dd>
        <dt className="text-muted-foreground">Object-storage requirements</dt>
        <dd>
          {storage.length ? (
            <ul className="space-y-1">
              {storage.map(([prefix, mode]) => (
                <li key={prefix} className="flex flex-wrap gap-2">
                  <span className="font-mono">{prefix}</span>
                  <span className="text-muted-foreground">{STORAGE_MODES[mode] ?? mode}</span>
                </li>
              ))}
            </ul>
          ) : (
            'None'
          )}
        </dd>
        {policy.reason && (
          <>
            <dt className="text-muted-foreground">Reason</dt>
            <dd className="break-words">{policy.reason}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

type Row = { key: string; value: string };
const rowsOf = (map: Record<string, string> | undefined) =>
  Object.entries(map ?? {}).map(([key, value]) => ({ key, value }));
const mapOf = (rows: Row[]) => Object.fromEntries(rows.map((row) => [row.key.trim(), row.value]));

function validate(form: PolicyForm, queue: Row[], storage: Row[]): string[] {
  const errors: string[] = [];
  if (parseVerificationAge(form.maxAge) === null)
    errors.push('Maximum evidence age must be whole seconds from 1s to 24h, such as 10m or 90s.');
  if (form.mode === 'off' && !form.reason.trim())
    errors.push('A reason is required to turn enforcement off.');
  if (new TextEncoder().encode(form.reason.trim()).length > REASON_MAX_BYTES)
    errors.push(`The reason must be at most ${REASON_MAX_BYTES} bytes.`);
  const queueNames = queue.map((row) => row.key.trim());
  if (queueNames.some((name) => !QUEUE_BINDING_NAME.test(name)))
    errors.push(
      'Queue binding names start with a lowercase letter, then lowercase letters, digits or hyphens.'
    );
  if (new Set(queueNames).size !== queueNames.length) errors.push('Each queue binding once.');
  const prefixes = storage.map((row) => row.key.trim());
  if (prefixes.some((prefix) => !STORAGE_PREFIX.test(prefix)))
    errors.push('Storage prefixes are uppercase letters, digits or underscores, such as MEDIA.');
  if (new Set(prefixes).size !== prefixes.length) errors.push('Each storage prefix once.');
  return errors;
}

function PolicyEditor({
  slug,
  scope,
  current,
  onDone,
}: {
  slug: string;
  scope: string;
  current: ReleasePolicy;
  onDone: (outcome: 'saved' | 'cancelled' | 'conflict') => void;
}) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const save = useSetReleasePolicy(accountId, slug, scope);
  const confirm = useConfirm();
  const { toast } = useToast();
  const queueCapability = useCapability('queue-bindings');
  const storageCapability = useCapability('object-storage');
  const queueEditable = queueCapability.state === 'available';
  const storageEditable = storageCapability.state === 'available';
  const [mode, setMode] = useState(current.mode);
  const [maxAge, setMaxAge] = useState(current.max_verification_age);
  const [requireAck, setRequireAck] = useState(current.require_application_ack);
  const [reason, setReason] = useState('');
  const [queue, setQueue] = useState<Row[]>(rowsOf(current.queue_requirements));
  const [storage, setStorage] = useState<Row[]>(rowsOf(current.object_storage_requirements));
  const [errors, setErrors] = useState<string[]>([]);
  const [failure, setFailure] = useState('');
  const errorId = useId();
  const modeName = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const form: PolicyForm = {
      mode,
      maxAge,
      requireAck,
      reason,
      queue: mapOf(queue),
      storage: mapOf(storage),
    };
    const found = validate(form, queue, storage);
    setErrors(found);
    setFailure('');
    if (found.length) return;
    if (mode !== current.mode) {
      const ok = await confirm(
        mode === 'enforce'
          ? {
              title: `Enforce binding evidence in ${scope}?`,
              description:
                'Promotions, traffic changes and canary advances in this scope will be refused until the deployment gaining traffic has fresh binding evidence. New canaries must start at 0%. Serving traffic does not change now.',
              confirmLabel: 'Enforce',
            }
          : {
              title: `Turn off binding enforcement in ${scope}?`,
              description:
                'Traffic in this scope can then increase without binding evidence. The change and your reason are recorded in the policy history.',
              confirmLabel: 'Turn off enforcement',
              destructive: true,
            }
      );
      if (!ok) return;
    }
    save.mutate(
      { current, form },
      {
        onSuccess: (next) => {
          toast({
            kind: 'success',
            title: `Release policy saved for ${scope}`,
            description: `Now at revision ${next.revision}.`,
          });
          onDone('saved');
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'bindings_release_policy_changed') {
            onDone('conflict');
            return;
          }
          setFailure(
            error instanceof ApiError && error.code === 'not_found'
              ? 'This app or its release policy is not available. Reload the page to check it still exists.'
              : errorMessage(error)
          );
        },
      }
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <fieldset className="space-y-2">
        <legend className="text-xs text-muted-foreground">Mode</legend>
        <div className="flex flex-wrap gap-4">
          {(['enforce', 'off'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name={modeName}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {value === 'enforce' ? 'Enforce' : 'Off'}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Maximum evidence age</span>
        <Input
          aria-label="Maximum evidence age"
          value={maxAge}
          onChange={(e) => setMaxAge(e.target.value)}
          className="w-40 font-mono"
        />
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={requireAck}
          onChange={(e) => setRequireAck(e.target.checked)}
        />
        <span>
          Require current application acknowledgements
          <span className="block text-xs text-muted-foreground">
            Managed-secret receipts are self-attestations, not proof of use.
          </span>
        </span>
      </label>

      <Requirements
        kind="queue"
        rows={queue}
        setRows={setQueue}
        editable={queueEditable}
        options={QUEUE_EVIDENCE}
        hint="consumer_readiness needs a healthy push consumer poll; handler_completion needs a completed canary."
      />
      <Requirements
        kind="storage"
        rows={storage}
        setRows={setStorage}
        editable={storageEditable}
        options={STORAGE_MODES}
        hint="Prefixes are managed environment prefixes in this scope."
      />

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          Reason {mode === 'off' ? '(required to turn enforcement off)' : '(optional)'}
        </span>
        <Input
          aria-label="Reason"
          value={reason}
          maxLength={REASON_MAX_BYTES}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      {errors.length > 0 && (
        <div id={errorId} role="alert" className="space-y-1">
          {errors.map((message) => (
            <FieldError key={message} id={`${errorId}-${message}`}>
              {message}
            </FieldError>
          ))}
        </div>
      )}
      {failure && (
        <p role="alert" style={{ color: 'var(--status-critical)' }}>
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save policy'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone('cancelled')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Requirements({
  kind,
  rows,
  setRows,
  editable,
  options,
  hint,
}: {
  kind: 'queue' | 'storage';
  rows: Row[];
  setRows: (rows: Row[]) => void;
  editable: boolean;
  options: Record<string, string>;
  hint: string;
}) {
  const title = kind === 'queue' ? 'Queue requirements' : 'Object-storage requirements';
  const keyLabel = kind === 'queue' ? 'Queue binding' : 'Storage prefix';
  const valueLabel = kind === 'queue' ? 'Queue evidence' : 'Storage mode';
  const capability = kind === 'queue' ? 'Queue bindings' : 'Object storage';
  if (!editable) {
    if (!rows.length) return null;
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{title}</p>
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap gap-2">
              <span className="font-mono">{row.key}</span>
              <span className="text-muted-foreground">{options[row.value] ?? row.value}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Stored {title.toLowerCase()} are kept as they are. Editing them needs {capability}, which
          is not available on this account.
        </p>
      </div>
    );
  }
  const update = (index: number, patch: Partial<Row>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs text-muted-foreground">{title}</legend>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {rows.map((row, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={`${keyLabel} ${index + 1}`}
            value={row.key}
            onChange={(e) => update(index, { key: e.target.value })}
            className="w-48 font-mono"
          />
          <Select
            aria-label={`${valueLabel} ${index + 1}`}
            value={row.value}
            onChange={(e) => update(index, { value: e.target.value })}
          >
            {Object.entries(options).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${kind} requirement ${index + 1}`}
            onClick={() => setRows(rows.filter((_, i) => i !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      {rows.length < REQUIREMENTS_MAX && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows([...rows, { key: '', value: Object.keys(options)[0] }])}
        >
          Add {kind} requirement
        </Button>
      )}
    </fieldset>
  );
}
