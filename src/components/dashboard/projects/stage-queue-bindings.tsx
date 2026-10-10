import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useCapability } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  readStageQueueWriteContext,
  replaceStageQueueBindings,
  stageQueueBindingsKey,
  useStageQueueBindings,
  type StageQueueSelection,
  type StageQueueSnapshot,
} from '@/lib/api/queue-bindings';
import { stageQueueFingerprint, stageQueuePayload, type StageBinding } from '@/lib/stage-queue';
import type { EnvironmentState } from '@/lib/api/projects';
import { Panel } from '../primitives';

const fieldClass =
  'w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

function BindingRow({
  binding,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  binding: StageBinding;
  index: number;
  disabled: boolean;
  onChange: (next: StageBinding) => void;
  onRemove: () => void;
}) {
  const title = binding.name || `new ${index + 1}`;
  return (
    <li className="space-y-3 rounded border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Binding name {index + 1}
          <input
            className={fieldClass}
            value={binding.name}
            disabled={disabled}
            onChange={(event) => onChange({ ...binding, name: event.target.value })}
          />
        </label>
        <label className="text-sm">
          Queue name {index + 1}
          <input
            className={fieldClass}
            value={binding.queue_name}
            disabled={disabled}
            onChange={(event) => onChange({ ...binding, queue_name: event.target.value })}
          />
        </label>
        <label className="text-sm">
          Delivery mode {title}
          <select
            className={fieldClass}
            value={binding.mode}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...binding, mode: event.target.value as StageBinding['mode'] })
            }
          >
            <option value="pull">External pull</option>
            <option value="push">Platform push</option>
          </select>
        </label>
        <label className="text-sm">
          Workload class {title}
          <select
            className={fieldClass}
            value={binding.workload_class}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...binding,
                workload_class: event.target.value as StageBinding['workload_class'],
              })
            }
          >
            <option value="worker">Worker</option>
            <option value="job">Job</option>
            <option value="http">HTTP function</option>
          </select>
        </label>
        <label className="text-sm">
          Max concurrency {title}
          <input
            className={fieldClass}
            type="number"
            min={1}
            max={10000}
            value={binding.max_concurrency}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...binding, max_concurrency: Number(event.target.value) })
            }
          />
        </label>
        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={binding.enabled}
            disabled={disabled}
            onChange={(event) => onChange({ ...binding, enabled: event.target.checked })}
          />
          Enabled in desired settings
        </label>
      </div>
      {binding.retry_policy && (
        <p className="text-xs text-muted-foreground">Existing retry policy is preserved.</p>
      )}
      <Button variant="outline" size="sm" disabled={disabled} onClick={onRemove}>
        Remove {title}
      </Button>
    </li>
  );
}

function Editor({
  selection,
  protectedStage,
  snapshot,
  refresh,
}: {
  selection: StageQueueSelection;
  protectedStage: boolean;
  snapshot: StageQueueSnapshot;
  refresh: () => void;
}) {
  const capability = useCapability('worker-pools');
  const cache = useQueryClient();
  const initial = snapshot.kind === 'ready' ? snapshot.data.bindings : [];
  const [draft, setDraft] = useState<StageBinding[]>(() => initial.map((item) => ({ ...item })));
  const [review, setReview] = useState<{
    fingerprint: string;
    body: ReturnType<typeof stageQueuePayload>;
  } | null>(null);
  const [emptyAcknowledged, setEmptyAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current?.abort();
    };
  }, []);
  const canWrite =
    !protectedStage &&
    capability.accountId === selection.accountId &&
    capability.state === 'available' &&
    selection.plan !== 'free';
  const original = snapshot.kind === 'ready' ? snapshot.data.bindings : [];
  const revision =
    snapshot.kind === 'ready' ? snapshot.data.workload_revision : snapshot.workloadRevision;
  function change(index: number, next: StageBinding) {
    setDraft((current) => current.map((item, at) => (at === index ? next : item)));
  }
  async function verifyAndReview() {
    if (!canWrite || busy || uncertain) return;
    setBusy(true);
    setMessage('');
    const controller = new AbortController();
    pending.current = controller;
    try {
      const body = stageQueuePayload(snapshot, draft);
      const fresh = await readStageQueueWriteContext(selection, controller.signal);
      if (!active.current || controller.signal.aborted) return;
      if (stageQueueFingerprint(fresh) !== stageQueueFingerprint(snapshot)) {
        refresh();
        throw new Error('Stage workload settings changed. Refresh and review again.');
      }
      setReview({ fingerprint: stageQueueFingerprint(fresh), body });
      setEmptyAcknowledged(false);
    } catch (error) {
      if (active.current) setMessage(errorMessage(error));
    } finally {
      if (pending.current === controller) pending.current = null;
      if (active.current) setBusy(false);
    }
  }
  async function save() {
    if (!review || !canWrite || busy || (review.body.bindings.length === 0 && !emptyAcknowledged))
      return;
    setBusy(true);
    setMessage('');
    const controller = new AbortController();
    pending.current = controller;
    let submitted = false;
    try {
      const fresh = await readStageQueueWriteContext(selection, controller.signal);
      if (!active.current || controller.signal.aborted) return;
      if (stageQueueFingerprint(fresh) !== review.fingerprint) {
        setReview(null);
        refresh();
        throw new Error('Stage workload settings changed. Refresh and review again.');
      }
      submitted = true;
      const result = await replaceStageQueueBindings(
        selection.project,
        selection.environment,
        selection.workload,
        review.body,
        controller.signal
      );
      if (!active.current || controller.signal.aborted) return;
      if (
        result.environment !== selection.environment ||
        result.workload !== selection.workload ||
        result.activation_state !== 'unavailable'
      )
        throw new Error(
          'Stage response did not confirm the selected workload. Inspect before another attempt.'
        );
      setReview(null);
      setMessage(
        'Desired stage definitions saved. Activation remains unavailable; no consumer delivery is proven.'
      );
      void cache.invalidateQueries({
        queryKey: stageQueueBindingsKey(
          selection.accountId,
          selection.project,
          selection.environment,
          selection.workload
        ),
      });
      refresh();
    } catch (error) {
      if (!active.current || controller.signal.aborted) return;
      setReview(null);
      if (error instanceof ApiError && error.status === 409) {
        setMessage('Stage workload settings changed. Refresh and review again.');
        refresh();
      } else if (!submitted) {
        setMessage(errorMessage(error));
      } else if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      ) {
        setMessage(
          `Stage replacement was rejected. Correct and review again. ${errorMessage(error)}`
        );
      } else {
        setUncertain(true);
        setMessage(
          `The stage write outcome is unconfirmed. Refresh and inspect before a new review. ${errorMessage(error)}`
        );
      }
    } finally {
      if (pending.current === controller) pending.current = null;
      if (active.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-4 p-4 text-sm">
      <p className="break-all">
        {snapshot.kind === 'ready'
          ? `Queue collection revision ${snapshot.data.revision} · workload revision ${revision} · hash ${snapshot.data.config_hash}`
          : `Queue collection not initialized · workload revision ${revision}`}
      </p>
      <p role="status">
        Activation unavailable. These are desired definitions only; no stage consumer is running or
        qualified for promotion.
      </p>
      {original.length > 0 ? (
        <ul className="space-y-1">
          {original.map((item) => (
            <li key={item.name}>
              {item.name} · {item.queue_name} · {item.mode} {item.workload_class} ·{' '}
              {item.enabled ? 'enabled' : 'disabled'}
            </li>
          ))}
        </ul>
      ) : (
        <p>No desired stage bindings are recorded.</p>
      )}
      {protectedStage ? (
        <p role="status">
          Protected stage. Apply changes through an approved project plan or promotion.
        </p>
      ) : !canWrite ? (
        <p role="status">Worker-pool availability must be confirmed before editing this stage.</p>
      ) : uncertain ? (
        <Button
          variant="outline"
          onClick={() => {
            setUncertain(false);
            refresh();
          }}
        >
          Refresh and inspect stage
        </Button>
      ) : review ? (
        <div className="space-y-3 rounded border border-border p-3">
          <p>
            Replace the complete stage list at workload revision {review.body.expected_revision}:{' '}
            {review.body.bindings.length} desired definitions.
          </p>
          <ul className="space-y-1">
            {review.body.bindings.map((item) => (
              <li key={item.name}>
                {item.name} → {item.queue_name} · {item.mode} {item.workload_class} · concurrency{' '}
                {item.max_concurrency} · {item.enabled ? 'enabled' : 'disabled'}
              </li>
            ))}
          </ul>
          {review.body.bindings.length === 0 && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={emptyAcknowledged}
                onChange={(event) => setEmptyAcknowledged(event.target.checked)}
              />
              Remove all desired stage bindings
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || (review.body.bindings.length === 0 && !emptyAcknowledged)}
              onClick={() => void save()}
            >
              Save stage definitions
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setReview(null)}>
              Edit definitions
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-3">
            {draft.map((item, index) => (
              <BindingRow
                key={index}
                binding={item}
                index={index}
                disabled={busy}
                onChange={(next) => change(index, next)}
                onRemove={() => setDraft((current) => current.filter((_, at) => at !== index))}
              />
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                setDraft((current) => [
                  ...current,
                  {
                    name: '',
                    queue_name: '',
                    mode: 'pull',
                    workload_class: 'worker',
                    enabled: true,
                    max_concurrency: 1,
                  },
                ])
              }
            >
              Add stage binding
            </Button>
            <Button disabled={busy} onClick={() => void verifyAndReview()}>
              Review complete stage replacement
            </Button>
          </div>
        </div>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}

export function StageQueueBindings({
  selection,
  protectedStage,
}: {
  selection: StageQueueSelection;
  protectedStage: boolean;
}) {
  const query = useStageQueueBindings(
    selection.accountId,
    selection.project,
    selection.environment,
    selection.workload
  );
  return (
    <Panel
      title={`Stage queue definitions · ${selection.workload}`}
      description="Desired settings for the selected project, environment and workload. Production consumers are managed on the app Queues tab."
    >
      {query.isPending ? (
        <p role="status" className="p-4">
          Loading stage queue settings…
        </p>
      ) : query.error ? (
        <div className="p-4">
          <p role="alert">{errorMessage(query.error)}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry stage read
          </Button>
        </div>
      ) : (
        query.data && (
          <Editor
            key={stageQueueFingerprint(query.data)}
            selection={selection}
            protectedStage={protectedStage}
            snapshot={query.data}
            refresh={() => void query.refetch()}
          />
        )
      )}
    </Panel>
  );
}

export function StageQueueOverview({
  accountId,
  plan,
  project,
  projectId,
  environment,
  environmentId,
  protectedStage,
  workloads,
  selectedWorkload,
  onSelectWorkload,
}: {
  accountId: string;
  plan: StageQueueSelection['plan'];
  project: string;
  projectId: string;
  environment: string;
  environmentId: string;
  protectedStage: boolean;
  workloads: EnvironmentState['workloads'];
  selectedWorkload?: string;
  onSelectWorkload: (slug?: string) => void;
}) {
  const selected = workloads.find((item) => item.workload_slug === selectedWorkload && item.app_id);
  return (
    <div className="space-y-3">
      <label className="block max-w-md text-sm">
        Stage workload
        <select
          className={fieldClass}
          value={selectedWorkload ?? ''}
          onChange={(event) => onSelectWorkload(event.target.value || undefined)}
        >
          <option value="">Select a project workload</option>
          {workloads
            .filter((item) => item.app_id)
            .map((item) => (
              <option key={item.workload_slug} value={item.workload_slug}>
                {item.workload_name} ({item.workload_slug})
              </option>
            ))}
        </select>
        {selectedWorkload && !selected && (
          <p role="alert">Selected stage workload is unavailable.</p>
        )}
      </label>
      {selected?.app_id && (
        <StageQueueBindings
          key={`${accountId}:${project}:${environment}:${selected.workload_slug}:${selected.app_id}`}
          selection={{
            accountId,
            plan,
            project,
            projectId,
            environment,
            environmentId,
            workload: selected.workload_slug,
            appId: selected.app_id,
          }}
          protectedStage={protectedStage}
        />
      )}
    </div>
  );
}
