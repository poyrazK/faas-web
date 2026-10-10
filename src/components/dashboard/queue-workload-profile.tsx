import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { useApp, type App } from '@/lib/api/queries';
import {
  configureQueueWorkload,
  queueBindingsKey,
  readQueueBindingContext,
  type QueueBinding,
  type QueueWorkloadProfile as ProfileRequest,
} from '@/lib/api/queue-bindings';
import type { components } from '@/lib/api/schema';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  clearQueueWorkloadAttempt,
  readQueueWorkloadAttempt,
  saveQueueWorkloadAttempt,
  type QueueWorkloadAttempt,
} from '@/lib/queue-workload-attempt';

type Plan = components['schemas']['CapabilitiesResponse']['plan'];
type Props = { accountId: string; plan: Plan; slug: string; bindings: QueueBinding[] };
const namePattern = /^[a-z][a-z0-9-]{0,62}$/;

function fingerprint(app: App, bindings: QueueBinding[]) {
  return JSON.stringify([
    app.id,
    app.workload_class,
    app.scaling_policy,
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
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  ]);
}

export function QueueWorkloadProfile(props: Props) {
  const app = useApp(props.slug, { enabled: Boolean(props.accountId) }, props.accountId).data;
  return <Profile key={`${props.accountId}:${props.slug}:${app?.id ?? ''}`} {...props} app={app} />;
}

function Profile({ accountId, plan, slug, bindings, app }: Props & { app?: App }) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [queueName, setQueueName] = useState(
    () => bindings.find((binding) => binding.name === 'default')?.queue_name ?? 'default'
  );
  const [maxConcurrency, setMaxConcurrency] = useState(
    () => bindings.find((binding) => binding.name === 'default')?.max_concurrency ?? 1
  );
  const [targetDepth, setTargetDepth] = useState(() =>
    String(app?.scaling_policy?.target?.metric) === 'queue_depth'
      ? (app?.scaling_policy?.target?.value ?? 10)
      : 10
  );
  const [review, setReview] = useState<{
    fingerprint: string;
    request: ProfileRequest;
    priorQueue?: string;
    requiresConsent: boolean;
  } | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState<QueueWorkloadAttempt | null>(() =>
    readQueueWorkloadAttempt(accountId, slug)
  );
  const [inspection, setInspection] = useState('');
  const [inspected, setInspected] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const context = useRef({ accountId, slug, appId: app?.id });
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
  const supported = app?.workload_class === 'worker' || app?.workload_class === 'job';
  const defaultBindings = bindings.filter((binding) => binding.name === 'default');

  async function prepare() {
    if (!app || !supported || busy || attempt) return;
    if (
      !namePattern.test(queueName) ||
      !Number.isInteger(maxConcurrency) ||
      maxConcurrency < 1 ||
      maxConcurrency > 10000 ||
      !Number.isFinite(targetDepth) ||
      targetDepth <= 0
    ) {
      setMessage(
        'Use a valid lowercase queue name, concurrency from 1 to 10000, and a positive queue-depth target.'
      );
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
      if (fingerprint(fresh.app, fresh.bindings) !== fingerprint(app, bindings)) {
        setMessage('The app or bindings changed since this page loaded. Refresh and review again.');
        await cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) });
        return;
      }
      const defaults = fresh.bindings.filter((binding) => binding.name === 'default');
      if (defaults.length > 1) {
        setMessage(
          'Multiple default bindings exist. Resolve them before using the simple push profile.'
        );
        return;
      }
      const priorQueue = defaults[0]?.queue_name;
      setConsent(false);
      setReview({
        fingerprint: fingerprint(fresh.app, fresh.bindings),
        request: {
          queue_name: queueName,
          workload_class: app.workload_class as 'worker' | 'job',
          max_concurrency: maxConcurrency,
          target_depth: targetDepth,
          force: Boolean(priorQueue && priorQueue !== queueName),
        },
        priorQueue,
        requiresConsent: Boolean(defaults[0]),
      });
    } catch (error) {
      if (stillHere(start) && !controller.signal.aborted) setMessage(errorMessage(error));
    } finally {
      if (stillHere(start)) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  async function apply() {
    if (!app || !review || busy || attempt || (review.requiresConsent && !consent)) return;
    const start = { ...context.current };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const fresh = await readQueueBindingContext(accountId, slug, plan, controller.signal);
      if (!stillHere(start)) return;
      if (fingerprint(fresh.app, fresh.bindings) !== review.fingerprint) {
        setReview(null);
        setMessage('The default binding or scaling policy changed since review. Review again.');
        await cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) });
        return;
      }
      const intent: QueueWorkloadAttempt = {
        version: 1,
        accountId,
        slug,
        appId: app.id,
        beforeFingerprint: review.fingerprint,
        request: review.request,
        createdAt: Date.now(),
      };
      saveQueueWorkloadAttempt(intent);
      setAttempt(intent);
      const result = await configureQueueWorkload(slug, review.request, controller.signal);
      if (!stillHere(start)) return;
      if (
        result.app.id !== app.id ||
        result.binding.name !== 'default' ||
        result.binding.queue_name !== review.request.queue_name
      )
        throw new Error('Profile response did not confirm the requested default binding.');
      clearQueueWorkloadAttempt(accountId, slug);
      setAttempt(null);
      setReview(null);
      setOpen(false);
      setMessage(
        `Push profile accepted for binding ${result.binding.id}. Check consumer liveness separately.`
      );
      await Promise.all([
        cache.invalidateQueries({ queryKey: queueBindingsKey(accountId, slug) }),
        cache.invalidateQueries({ queryKey: ['apps', 'account', accountId, slug] }),
      ]);
    } catch (error) {
      if (stillHere(start)) {
        setReview(null);
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 429
        ) {
          clearQueueWorkloadAttempt(accountId, slug);
          setAttempt(null);
          setMessage(
            `Push profile was rejected. Review again after correction. ${errorMessage(error)}`
          );
        } else if (readQueueWorkloadAttempt(accountId, slug)) {
          setMessage(
            `Push profile outcome is unconfirmed. Inspect the default binding and scaling policy before another attempt. ${errorMessage(error)}`
          );
        } else if (!controller.signal.aborted) setMessage(errorMessage(error));
      }
    } finally {
      if (stillHere(start)) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  async function inspect() {
    if (!attempt || !app || app.id !== attempt.appId || busy) return;
    const start = { ...context.current };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setInspection('');
    setInspected(false);
    setAcknowledged(false);
    try {
      const fresh = await readQueueBindingContext(accountId, slug, plan, controller.signal);
      if (!stillHere(start) || fresh.app.id !== attempt.appId) return;
      const defaults = fresh.bindings.filter((binding) => binding.name === 'default');
      setInspection(
        `Current default ${defaults.length === 1 ? `binding ${defaults[0].id} points to ${defaults[0].queue_name}` : defaults.length ? 'has multiple bindings' : 'binding is absent'}. Current scaling target: ${fresh.app.scaling_policy?.target?.metric ?? 'unset'} ${fresh.app.scaling_policy?.target?.value ?? ''}. These observations do not prove which request changed them.`
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
    if (!attempt || !inspected || !acknowledged || busy || app?.id !== attempt.appId) return;
    clearQueueWorkloadAttempt(accountId, slug);
    setAttempt(null);
    setInspection('');
    setInspected(false);
    setAcknowledged(false);
    setOpen(false);
    setMessage(
      'Prior profile attempt cleared after inspection. A new request requires fresh review.'
    );
  }

  return (
    <div className="space-y-2 rounded border border-border p-3 text-sm">
      <p>
        Simple profile: platform push consumer plus queue-depth scaling. Pull workers use explicit
        bindings above.
      </p>
      {attempt ? (
        <div className="space-y-2">
          <p>
            Profile request for {attempt.request.queue_name} may have been accepted. It will not be
            resent automatically.
          </p>
          <Button
            variant="outline"
            disabled={busy || !app || app.id !== attempt.appId}
            onClick={() => void inspect()}
          >
            Inspect profile outcome
          </Button>
          {app && app.id !== attempt.appId && (
            <p role="alert">
              This slug now identifies a different app; this attempt cannot be cleared here.
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
                  I inspected the default binding and scaling policy and understand another request
                  may repeat or replace accepted work.
                </span>
              </label>
              <Button variant="outline" disabled={busy || !acknowledged} onClick={clearInspected}>
                Start a new reviewed profile
              </Button>
            </>
          )}
        </div>
      ) : (
        <Button variant="outline" disabled={busy || !supported} onClick={() => setOpen(true)}>
          Configure platform push profile
        </Button>
      )}
      {!supported && (
        <p role="status">Deploy a characterized worker or job before configuring this profile.</p>
      )}
      {open && !attempt && (
        <div className="space-y-2">
          <p>
            Current default queue:{' '}
            {defaultBindings.length === 1
              ? defaultBindings[0].queue_name
              : defaultBindings.length
                ? 'Multiple defaults'
                : 'None'}
            . Current scaling target: {app?.scaling_policy?.target?.metric ?? 'Not set'}{' '}
            {app?.scaling_policy?.target?.value ?? ''}.
          </p>
          <label className="block space-y-1">
            <span>Profile queue</span>
            <input
              className={FIELD}
              value={queueName}
              disabled={busy || Boolean(review)}
              onChange={(event) => setQueueName(event.target.value)}
            />
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
          <label className="block space-y-1">
            <span>Target queue depth</span>
            <input
              className={FIELD}
              type="number"
              min={0.01}
              step="any"
              value={targetDepth}
              disabled={busy || Boolean(review)}
              onChange={(event) => setTargetDepth(Number(event.target.value))}
            />
          </label>
          {review ? (
            <div className="space-y-2 rounded border border-border p-3">
              <p>
                Platform push to {review.request.queue_name}, max concurrency{' '}
                {review.request.max_concurrency}, queue-depth target {review.request.target_depth}.
              </p>
              {review.requiresConsent && (
                <>
                  {review.request.force ? (
                    <p>
                      This will replace the current default queue {review.priorQueue}. Existing
                      queued work is separate.
                    </p>
                  ) : (
                    <p>
                      This will replace the current default binding configuration with a platform
                      push consumer. Existing queued work is separate.
                    </p>
                  )}
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    <span>
                      I approve replacing the default {review.request.force ? 'queue' : 'binding'}.
                    </span>
                  </label>
                </>
              )}
              <Button
                disabled={busy || (review.requiresConsent && !consent)}
                onClick={() => void apply()}
              >
                Apply push profile
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setReview(null)}>
                Edit profile review
              </Button>
            </div>
          ) : (
            <Button disabled={busy} onClick={() => void prepare()}>
              Review push profile
            </Button>
          )}
        </div>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
