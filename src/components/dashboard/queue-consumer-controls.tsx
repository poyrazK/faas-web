import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { useApp, type App } from '@/lib/api/queries';
import {
  createQueueBinding,
  queueBindingsKey,
  readQueueBindingContext,
  type CreateQueueBinding,
  type QueueBinding,
} from '@/lib/api/queue-bindings';
import type { components } from '@/lib/api/schema';
import {
  clearQueueBindingOperation,
  newQueueBindingOperation,
  readQueueBindingOperation,
  saveQueueBindingOperation,
  type QueueBindingOperation,
} from '@/lib/queue-binding-operation';
import { ApiError, errorMessage } from '@/lib/api/errors';

type Plan = components['schemas']['CapabilitiesResponse']['plan'];
const namePattern = /^[a-z][a-z0-9-]{0,62}$/;

function fingerprint(appId: string, workloadClass: string | undefined, bindings: QueueBinding[]) {
  return JSON.stringify([
    appId,
    workloadClass,
    ...bindings
      .map((binding) => [
        binding.id,
        binding.name,
        binding.queue_name,
        binding.mode,
        binding.workload_class,
        binding.enabled,
        binding.max_concurrency,
        binding.updated_at,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}

type Props = {
  accountId: string;
  plan: Plan;
  slug: string;
  bindings: QueueBinding[];
};

export function QueueConsumerControls(props: Props) {
  const appQuery = useApp(props.slug, { enabled: Boolean(props.accountId) }, props.accountId);
  return (
    <QueueConsumerControlsInner
      key={`${props.accountId}:${props.slug}:${appQuery.data?.id ?? ''}`}
      {...props}
      app={appQuery.data}
    />
  );
}

function QueueConsumerControlsInner({
  accountId,
  plan,
  slug,
  bindings,
  app,
}: Props & { app?: App }) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [queueName, setQueueName] = useState('');
  const [mode, setMode] = useState<'pull' | 'push'>('pull');
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [review, setReview] = useState<{ fingerprint: string; request: CreateQueueBinding } | null>(
    null
  );
  const [operation, setOperation] = useState<QueueBindingOperation | null>(() =>
    readQueueBindingOperation(accountId, slug)
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [inspection, setInspection] = useState('');
  const [inspected, setInspected] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const context = useRef({ accountId, slug, appId: app?.id });
  const pending = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useLayoutEffect(() => {
    context.current = { accountId, slug, appId: app?.id };
  }, [accountId, slug, app?.id]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);
  const stillHere = (start: typeof context.current) =>
    alive.current &&
    start.accountId === context.current.accountId &&
    start.slug === context.current.slug &&
    start.appId === context.current.appId;
  const workloadClass = app?.workload_class;
  const canCreate =
    workloadClass === 'worker' || workloadClass === 'job' || workloadClass === 'http';

  async function reviewCreate() {
    if (!app || !canCreate || operation || busy) return;
    if (!namePattern.test(name) || !namePattern.test(queueName)) {
      setMessage(
        'Binding and queue names must start with a lowercase letter and use lowercase letters, digits or hyphens, up to 63 characters.'
      );
      return;
    }
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 10000) {
      setMessage('Max concurrency must be between 1 and 10000.');
      return;
    }
    if (workloadClass === 'http' && mode === 'pull') {
      setMessage('HTTP workloads use push delivery. Choose a worker or job for pull delivery.');
      return;
    }
    const start = { ...context.current };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const fresh = await readQueueBindingContext(accountId, slug, plan, controller.signal);
      if (!stillHere(start)) return;
      if (
        fingerprint(fresh.app.id, fresh.app.workload_class, fresh.bindings) !==
        fingerprint(app.id, workloadClass, bindings)
      ) {
        setMessage('Bindings changed since this page loaded. Refresh and review again.');
        await cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) });
        return;
      }
      if (fresh.bindings.some((binding) => binding.name === name)) {
        setMessage('A binding with this name already exists. Inspect it before creating another.');
        return;
      }
      const request: CreateQueueBinding = {
        name,
        queue_name: queueName,
        mode,
        workload_class: workloadClass as CreateQueueBinding['workload_class'],
        enabled: true,
        max_concurrency: maxConcurrency,
      };
      setReview({
        fingerprint: fingerprint(fresh.app.id, fresh.app.workload_class, fresh.bindings),
        request,
      });
    } catch (error) {
      if (stillHere(start) && !controller.signal.aborted) setMessage(errorMessage(error));
    } finally {
      if (stillHere(start)) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  async function create() {
    if (!app || !review || operation || busy) return;
    const start = { ...context.current };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const fresh = await readQueueBindingContext(accountId, slug, plan, controller.signal);
      if (!stillHere(start)) return;
      if (
        fingerprint(fresh.app.id, fresh.app.workload_class, fresh.bindings) !== review.fingerprint
      ) {
        setReview(null);
        setMessage('Bindings changed since review. Refresh and review again.');
        await cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) });
        return;
      }
      const intent = newQueueBindingOperation(accountId, slug, app.id, review.request);
      saveQueueBindingOperation(intent);
      setOperation(intent);
      const result = await createQueueBinding(
        slug,
        review.request,
        intent.idempotencyKey,
        controller.signal
      );
      if (!stillHere(start)) return;
      if (!result?.id) throw new Error('Creation response did not identify a binding.');
      clearQueueBindingOperation(accountId, slug);
      setOperation(null);
      setReview(null);
      setOpen(false);
      setMessage(`Binding ${result.id} was accepted. Check its consumer state separately.`);
      await cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) });
    } catch (error) {
      if (stillHere(start)) {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 429
        ) {
          clearQueueBindingOperation(accountId, slug);
          setOperation(null);
          setReview(null);
          setMessage(
            `Binding creation was rejected. Correct the request and review again. ${errorMessage(error)}`
          );
        } else if (readQueueBindingOperation(accountId, slug)) {
          setReview(null);
          setMessage(
            'The creation outcome is unconfirmed. Inspect binding metadata before any new attempt.'
          );
        } else if (!controller.signal.aborted) setMessage(errorMessage(error));
      }
    } finally {
      if (stillHere(start)) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  async function inspect() {
    if (!operation || !app || app.id !== operation.appId || busy) return;
    const start = { ...context.current };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setInspection('');
    setInspected(false);
    setAcknowledged(false);
    try {
      const fresh = await readQueueBindingContext(accountId, slug, plan, controller.signal);
      if (!stillHere(start)) return;
      const matches = fresh.bindings.filter(
        (binding) =>
          binding.name === operation.request.name &&
          binding.queue_name === operation.request.queue_name &&
          binding.mode === operation.request.mode &&
          binding.workload_class === operation.request.workload_class
      );
      setInspection(
        matches.length
          ? `Found ${matches.length} matching binding record${matches.length === 1 ? '' : 's'}: ${matches.map((binding) => binding.id).join(', ')}. Inspect the binding before clearing this pending attempt.`
          : 'No matching binding metadata was found. The operation remains unconfirmed; inspect server state before clearing this attempt.'
      );
      setInspected(true);
      await cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) });
    } catch (error) {
      if (stillHere(start) && !controller.signal.aborted) setInspection(errorMessage(error));
    } finally {
      if (stillHere(start)) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  function clearInspectedOperation() {
    if (!operation || !app || app.id !== operation.appId || !inspected || !acknowledged || busy)
      return;
    clearQueueBindingOperation(accountId, slug);
    setOperation(null);
    setInspection('');
    setInspected(false);
    setAcknowledged(false);
    setOpen(false);
    setMessage(
      'The previous attempt was cleared after inspection. Any new request requires a fresh review.'
    );
  }

  return (
    <div className="space-y-3 rounded border border-border p-3 text-sm">
      {operation ? (
        <div className="space-y-2">
          <p>
            Binding creation for {operation.request.name} may have been accepted. The same request
            will not be sent again automatically.
          </p>
          <Button
            variant="outline"
            disabled={busy || !app || app.id !== operation.appId}
            onClick={() => void inspect()}
          >
            Inspect binding outcome
          </Button>
          {app && app.id !== operation.appId && (
            <p role="alert">
              This slug now identifies a different app. The pending attempt cannot be cleared from
              this app.
            </p>
          )}
          {inspection && <p role="status">{inspection}</p>}
          {inspected && (
            <>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>
                  I inspected the binding records and understand a new attempt could create a second
                  consumer or conflict.
                </span>
              </label>
              <Button
                variant="outline"
                disabled={busy || !acknowledged}
                onClick={clearInspectedOperation}
              >
                Start a new reviewed attempt
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <Button variant="outline" disabled={busy || !canCreate} onClick={() => setOpen(true)}>
            New binding
          </Button>
          {!canCreate && (
            <p role="status">
              Deploy a characterized worker, job, or HTTP workload before binding a queue.
            </p>
          )}
          {open && (
            <div className="space-y-3">
              <label className="block space-y-1">
                <span>Binding name</span>
                <input
                  className={FIELD}
                  value={name}
                  disabled={busy || Boolean(review)}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span>Queue name</span>
                <input
                  className={FIELD}
                  value={queueName}
                  disabled={busy || Boolean(review)}
                  onChange={(event) => setQueueName(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span>Delivery mode</span>
                <select
                  className={FIELD}
                  value={mode}
                  disabled={busy || Boolean(review)}
                  onChange={(event) => setMode(event.target.value as 'pull' | 'push')}
                >
                  <option value="pull">Pull</option>
                  <option value="push">Push</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span>Max concurrency</span>
                <input
                  className={FIELD}
                  type="number"
                  min={1}
                  max={10000}
                  value={maxConcurrency}
                  disabled={busy || Boolean(review)}
                  onChange={(event) => setMaxConcurrency(Number(event.target.value))}
                />
              </label>
              {review ? (
                <div className="space-y-2 rounded border border-border p-3">
                  <p>
                    {review.request.mode === 'pull'
                      ? 'External pull worker'
                      : 'Platform push delivery'}{' '}
                    · {review.request.workload_class} · {review.request.queue_name} · concurrency{' '}
                    {review.request.max_concurrency}
                  </p>
                  <p>Delivery can repeat work. Confirm the consumer handles replay safely.</p>
                  <Button disabled={busy} onClick={() => void create()}>
                    Create binding
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => setReview(null)}>
                    Edit review
                  </Button>
                </div>
              ) : (
                <Button disabled={busy} onClick={() => void reviewCreate()}>
                  Review binding
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
