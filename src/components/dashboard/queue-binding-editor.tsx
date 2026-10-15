import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import {
  deleteQueueBinding,
  queueBindingsKey,
  queueBindingStatusKey,
  readQueueBinding,
  readQueueBindingContext,
  updateQueueBinding,
  type QueueBinding,
  type UpdateQueueBinding,
} from '@/lib/api/queue-bindings';
import { ApiError, errorMessage } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';
import {
  clearQueueBindingWrite,
  readQueueBindingWrite,
  saveQueueBindingWrite,
  type QueueBindingWrite,
} from '@/lib/queue-binding-write';

type Plan = components['schemas']['CapabilitiesResponse']['plan'];
const namePattern = /^[a-z][a-z0-9-]{0,62}$/;
class StaleBindingError extends Error {}
function fingerprint(binding: QueueBinding) {
  return JSON.stringify([
    binding.id,
    binding.app_id,
    binding.account_id,
    binding.name,
    binding.queue_name,
    binding.mode,
    binding.workload_class,
    binding.enabled,
    binding.max_concurrency,
    binding.retry_policy,
    binding.updated_at,
    binding.retired_at,
  ]);
}

type Props = { accountId: string; plan: Plan; slug: string; binding: QueueBinding };
export function QueueBindingEditor(props: Props) {
  return (
    <Editor
      key={`${props.accountId}:${props.slug}:${props.binding.id}:${props.binding.updated_at}`}
      {...props}
    />
  );
}

function Editor({ accountId, plan, slug, binding }: Props) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [queueName, setQueueName] = useState(binding.queue_name);
  const [mode, setMode] = useState(binding.mode);
  const [maxConcurrency, setMaxConcurrency] = useState(binding.max_concurrency);
  const [pause, setPause] = useState(!binding.enabled);
  const [review, setReview] = useState<{
    fingerprint: string;
    action: 'update' | 'delete';
    body?: UpdateQueueBinding;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [write, setWrite] = useState<QueueBindingWrite | null>(() =>
    readQueueBindingWrite(accountId, slug, binding.id)
  );
  const [inspection, setInspection] = useState('');
  const [inspected, setInspected] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState('');
  const context = useRef({ accountId, slug, appId: binding.app_id, bindingId: binding.id });
  const pending = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useLayoutEffect(() => {
    context.current = { accountId, slug, appId: binding.app_id, bindingId: binding.id };
  }, [accountId, slug, binding.app_id, binding.id]);
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
    start.appId === context.current.appId &&
    start.bindingId === context.current.bindingId;

  async function fresh(controller: AbortController) {
    const state = await readQueueBindingContext(accountId, slug, plan, controller.signal);
    const byId = await readQueueBinding(slug, binding.id, controller.signal);
    const listed = state.bindings.find((row) => row.id === binding.id);
    if (
      state.app.id !== binding.app_id ||
      byId.id !== binding.id ||
      !listed ||
      fingerprint(listed) !== fingerprint(byId)
    )
      throw new StaleBindingError(
        'The app or binding changed since review. Refresh and review again.'
      );
    return byId;
  }

  async function prepare(action: 'update' | 'delete') {
    if (busy || write) return;
    let body: UpdateQueueBinding | undefined;
    if (action === 'update') {
      if (
        !namePattern.test(queueName) ||
        !Number.isInteger(maxConcurrency) ||
        maxConcurrency < 1 ||
        maxConcurrency > 10000
      ) {
        setMessage('Use a valid lowercase queue name and concurrency from 1 to 10000.');
        return;
      }
      if (binding.workload_class === 'http' && mode === 'pull') {
        setMessage('HTTP workloads require push delivery.');
        return;
      }
      body = {
        ...(queueName !== binding.queue_name ? { queue_name: queueName } : {}),
        ...(mode !== binding.mode ? { mode } : {}),
        ...(maxConcurrency !== binding.max_concurrency ? { max_concurrency: maxConcurrency } : {}),
        ...(pause !== !binding.enabled ? { enabled: !pause } : {}),
      };
      if (!Object.keys(body).length) {
        setMessage('No binding changes to review.');
        return;
      }
    }
    const start = { ...context.current };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const current = await fresh(controller);
      if (!stillHere(start)) return;
      if (fingerprint(current) !== fingerprint(binding)) {
        setMessage('The binding changed since this page loaded. Refresh and review again.');
        await cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) });
        return;
      }
      setReview({ fingerprint: fingerprint(current), action, body });
    } catch (error) {
      if (stillHere(start) && !controller.signal.aborted) {
        setMessage(errorMessage(error));
        if (error instanceof StaleBindingError)
          await cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) });
      }
    } finally {
      if (stillHere(start)) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  async function apply() {
    if (!review || busy || write) return;
    const start = { ...context.current };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const current = await fresh(controller);
      if (!stillHere(start)) return;
      if (fingerprint(current) !== review.fingerprint) {
        setReview(null);
        setMessage('The binding changed since review. Refresh and review again.');
        await cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) });
        return;
      }
      const intent: QueueBindingWrite = {
        version: 1,
        accountId,
        slug,
        appId: binding.app_id,
        bindingId: binding.id,
        action: review.action,
        beforeFingerprint: review.fingerprint,
        createdAt: Date.now(),
      };
      saveQueueBindingWrite(intent);
      setWrite(intent);
      if (review.action === 'delete') await deleteQueueBinding(slug, binding.id, controller.signal);
      else await updateQueueBinding(slug, binding.id, review.body ?? {}, controller.signal);
      if (!stillHere(start)) return;
      clearQueueBindingWrite(accountId, slug, binding.id);
      setWrite(null);
      setReview(null);
      setOpen(false);
      setMessage(
        review.action === 'delete'
          ? 'Binding deletion accepted. Pending work may still exist.'
          : 'Binding update accepted. Check consumer status separately.'
      );
      await Promise.all([
        cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) }),
        cache.invalidateQueries({ queryKey: queueBindingStatusKey(accountId, slug, binding.id) }),
      ]);
    } catch (error) {
      if (stillHere(start)) {
        setReview(null);
        if (error instanceof StaleBindingError) {
          setMessage('The binding changed since review. Refresh and review again.');
          await cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) });
        } else if (error instanceof ApiError && error.status === 409) {
          clearQueueBindingWrite(accountId, slug, binding.id);
          setWrite(null);
          setMessage('Binding conflict. Refresh the latest binding and review again.');
          await cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) });
        } else if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 429
        ) {
          clearQueueBindingWrite(accountId, slug, binding.id);
          setWrite(null);
          setMessage(
            `Binding change was rejected. Review again after correction. ${errorMessage(error)}`
          );
        } else {
          if (readQueueBindingWrite(accountId, slug, binding.id))
            setWrite(readQueueBindingWrite(accountId, slug, binding.id));
          setMessage(
            `The write outcome is unconfirmed. Inspect the binding before another change. ${errorMessage(error)}`
          );
        }
      }
    } finally {
      if (stillHere(start)) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  async function inspect() {
    if (!write || busy || binding.app_id !== write.appId) return;
    const start = { ...context.current };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setInspection('');
    setInspected(false);
    setAcknowledged(false);
    try {
      const current = await readQueueBindingContext(accountId, slug, plan, controller.signal);
      if (!stillHere(start) || current.app.id !== write.appId) return;
      const row = current.bindings.find((item) => item.id === write.bindingId);
      setInspection(
        row
          ? `Binding ${row.id} currently reports ${row.enabled ? 'enabled' : 'paused'}, ${row.mode}, queue ${row.queue_name}. This metadata does not prove which request changed it.`
          : `Binding ${write.bindingId} is absent from the current list. This does not prove which request removed it.`
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

  function clearInspected() {
    if (!write || !inspected || !acknowledged || busy || binding.app_id !== write.appId) return;
    clearQueueBindingWrite(accountId, slug, binding.id);
    setWrite(null);
    setInspection('');
    setInspected(false);
    setAcknowledged(false);
    setOpen(false);
    setMessage('Pending write cleared after inspection. A new change requires a fresh review.');
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={busy} onClick={() => setOpen(!open)}>
        Manage {binding.name}
      </Button>
      {open && (
        <div className="space-y-2 rounded border border-border p-3">
          <p>
            Binding {binding.name} · ID {binding.id} · {binding.mode} ·{' '}
            {binding.enabled ? 'enabled' : 'paused'}
          </p>
          {write ? (
            <div className="space-y-2">
              <p>
                {write.action === 'delete' ? 'Deletion' : 'Update'} may have been accepted. No
                request will be resent automatically.
              </p>
              <Button
                variant="outline"
                disabled={busy || binding.app_id !== write.appId}
                onClick={() => void inspect()}
              >
                Inspect write outcome
              </Button>
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
                      I inspected the binding state and understand another change could conflict or
                      repeat an accepted operation.
                    </span>
                  </label>
                  <Button
                    variant="outline"
                    disabled={busy || !acknowledged}
                    onClick={clearInspected}
                  >
                    Start a new reviewed change
                  </Button>
                </>
              )}
            </div>
          ) : review ? (
            <div className="space-y-2">
              <p>
                {review.action === 'delete'
                  ? `Delete binding ${binding.name} (${binding.id})`
                  : `${review.body?.enabled === false ? 'Pause delivery for ' : 'Update binding '}${binding.name}: ${JSON.stringify(review.body)}`}
              </p>
              <Button disabled={busy} onClick={() => void apply()}>
                {review.action === 'delete' ? 'Delete binding' : 'Save binding'}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setReview(null)}>
                Edit review
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block space-y-1">
                <span>Queue name</span>
                <input
                  className={FIELD}
                  value={queueName}
                  disabled={busy}
                  onChange={(event) => setQueueName(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span>Delivery mode</span>
                <select
                  className={FIELD}
                  value={mode}
                  disabled={busy}
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
                  disabled={busy}
                  onChange={(event) => setMaxConcurrency(Number(event.target.value))}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={pause}
                  disabled={busy}
                  onChange={(event) => setPause(event.target.checked)}
                />
                <span>Pause delivery</span>
              </label>
              <Button disabled={busy} onClick={() => void prepare('update')}>
                Review changes
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void prepare('delete')}>
                Review deletion
              </Button>
            </div>
          )}
        </div>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
