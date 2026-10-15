import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { errorMessage } from '@/lib/api/errors';
import {
  accountAppChoicesKey,
  bindingInventoryKey,
  patchServicePolicy,
  readServicePolicyContext,
  useAccountAppChoices,
} from '@/lib/api/bindings';
import { keys, type App } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import {
  buildServicePolicyPatch,
  draftFromServicePolicy,
  servicePolicyFingerprint,
  type ServicePolicyDraft,
} from '@/lib/service-policy';
import { Panel } from './primitives';

type Plan = components['schemas']['CapabilitiesResponse']['plan'];
type Review = {
  fingerprint: string;
  choices: string;
  draft: string;
  patch: NonNullable<ReturnType<typeof buildServicePolicyPatch>['patch']>;
  forwardTargets: string[];
};

export function ServicePolicyEditor({
  accountId,
  plan,
  slug,
  app,
  inventoryComplete,
  verifiedServices = [],
}: {
  accountId: string;
  plan: Plan;
  slug: string;
  app: App;
  inventoryComplete: boolean;
  verifiedServices?: string[];
}) {
  const queryClient = useQueryClient();
  const choices = useAccountAppChoices(accountId);
  const [draft, setDraft] = useState<ServicePolicyDraft>(() => draftFromServicePolicy(app));
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const context = useRef({ accountId, slug, appId: app.id });
  const alive = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    context.current = { accountId, slug, appId: app.id };
  }, [accountId, slug, app.id]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);

  const set = <K extends keyof ServicePolicyDraft>(key: K, value: ServicePolicyDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setReview(null);
    setMessage('');
  };
  const stillHere = (original: typeof context.current) =>
    alive.current &&
    context.current.accountId === original.accountId &&
    context.current.slug === original.slug &&
    context.current.appId === original.appId;

  async function reviewPolicy() {
    if (busy) return;
    const original = { ...context.current };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const fresh = await readServicePolicyContext(accountId, slug, plan, controller.signal);
      if (!stillHere(original)) return;
      if (servicePolicyFingerprint(fresh.app) !== servicePolicyFingerprint(app)) {
        setReview(null);
        setMessage(
          'The service policy changed while you were editing. Reload it and review again.'
        );
        await queryClient.invalidateQueries({ queryKey: ['apps', 'account', accountId, slug] });
        return;
      }
      const result = buildServicePolicyPatch(draft, fresh.choices);
      if (result.error || !result.patch) {
        setMessage(result.error ?? 'The service policy could not be reviewed.');
        return;
      }
      if (
        draft.transport === 'https' &&
        app.service_binding_transport !== 'https' &&
        (!inventoryComplete ||
          result.patch.service_binding_targets?.some(
            (target) => !verifiedServices.includes(target)
          ))
      ) {
        setMessage(
          'Private HTTPS is not verified for every selected binding. Use HTTP and run the CLI binding canary before switching transport.'
        );
        return;
      }
      setReview({
        fingerprint: servicePolicyFingerprint(fresh.app),
        choices: JSON.stringify(fresh.choices),
        draft: JSON.stringify(draft),
        patch: result.patch,
        forwardTargets: result.forwardTargets,
      });
    } catch (error) {
      if (stillHere(original) && !controller.signal.aborted) setMessage(errorMessage(error));
    } finally {
      if (stillHere(original)) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  async function savePolicy() {
    if (!review || busy) return;
    const original = { ...context.current };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const fresh = await readServicePolicyContext(accountId, slug, plan, controller.signal);
      if (!stillHere(original)) return;
      if (
        servicePolicyFingerprint(fresh.app) !== review.fingerprint ||
        JSON.stringify(fresh.choices) !== review.choices ||
        JSON.stringify(draft) !== review.draft
      ) {
        setReview(null);
        setMessage(
          'The service policy or app choices changed since review. Review the latest state again.'
        );
        await queryClient.invalidateQueries({ queryKey: ['apps', 'account', accountId, slug] });
        return;
      }
      const next = await patchServicePolicy(slug, review.patch, controller.signal);
      if (!stillHere(original)) return;
      setDraft(draftFromServicePolicy(next));
      setReview(null);
      setMessage(
        'Policy accepted. Gateway authorization changes immediately; new binding environment variables require a fresh instance. Verify runtime behavior separately.'
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['apps', 'account', accountId, slug] }),
        queryClient.invalidateQueries({ queryKey: keys.apps }),
        queryClient.invalidateQueries({ queryKey: bindingInventoryKey(accountId, slug) }),
        queryClient.invalidateQueries({ queryKey: accountAppChoicesKey(accountId) }),
      ]);
    } catch (error) {
      if (stillHere(original) && !controller.signal.aborted) {
        setReview(null);
        setMessage(
          `Policy was not confirmed. Refresh and review before retrying. ${errorMessage(error)}`
        );
      }
    } finally {
      if (stillHere(original)) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  return (
    <Panel
      title="Edit standalone service policy"
      description="Changes are reviewed against fresh app and account records before they are sent."
    >
      <div className="space-y-4 p-4 text-sm">
        {choices.isPending ? <p role="status">Loading account apps…</p> : null}
        {choices.error ? (
          <p role="alert">Could not read account apps. Refresh before editing.</p>
        ) : null}
        {choices.data && (
          <p className="text-xs text-muted-foreground">
            Account apps: {choices.data.map((item) => item.slug).join(', ') || 'none'}
          </p>
        )}
        <label className="block space-y-1">
          <span>Allowed callers</span>
          <select
            aria-label="Allowed callers"
            className={FIELD}
            disabled={busy}
            value={draft.callerMode}
            onChange={(event) =>
              set('callerMode', event.target.value as ServicePolicyDraft['callerMode'])
            }
          >
            <option value="account">Any authenticated same-account caller</option>
            <option value="deny">No internal callers</option>
            <option value="allow">Only named callers</option>
          </select>
        </label>
        {draft.callerMode === 'allow' && (
          <label className="block space-y-1">
            <span>Caller app slugs, one per line</span>
            <textarea
              className={FIELD}
              disabled={busy}
              value={draft.callers}
              onChange={(event) => set('callers', event.target.value)}
            />
          </label>
        )}
        <label className="block space-y-1">
          <span>Method and path grants</span>
          <select
            aria-label="Method and path grants"
            className={FIELD}
            disabled={busy}
            value={draft.scopeMode}
            onChange={(event) =>
              set('scopeMode', event.target.value as ServicePolicyDraft['scopeMode'])
            }
          >
            <option value="clear">No scoped grants</option>
            <option value="deny">Deny all callers with an empty scope map</option>
            <option value="rules">Use scoped grants</option>
          </select>
        </label>
        {draft.scopeMode === 'rules' && (
          <label className="block space-y-1">
            <span>Caller scopes JSON</span>
            <textarea
              className={FIELD}
              disabled={busy}
              rows={5}
              value={draft.scopesJson}
              onChange={(event) => set('scopesJson', event.target.value)}
            />
            <span className="block text-xs text-muted-foreground">
              Map each caller slug to methods and path_prefixes arrays. Missing callers are denied.
            </span>
          </label>
        )}
        <label className="block space-y-1">
          <span>Outbound target app slugs, one per line</span>
          <textarea
            aria-label="Outbound target app slugs"
            className={FIELD}
            disabled={busy}
            value={draft.targets}
            onChange={(event) => set('targets', event.target.value)}
          />
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            disabled={busy}
            checked={draft.allowForwardTargets}
            onChange={(event) => set('allowForwardTargets', event.target.checked)}
          />
          Allow reviewed future target names that are not yet account apps
        </label>
        <label className="block space-y-1">
          <span>Outbound reachability</span>
          <select
            className={FIELD}
            disabled={busy}
            value={draft.policy}
            onChange={(event) => set('policy', event.target.value as ServicePolicyDraft['policy'])}
          >
            <option value="account">Account</option>
            <option value="declared">Declared targets only</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span>Canonical binding transport</span>
          <select
            className={FIELD}
            disabled={busy}
            value={draft.transport}
            onChange={(event) =>
              set('transport', event.target.value as ServicePolicyDraft['transport'])
            }
          >
            <option value="http">HTTP</option>
            <option value="https">Private HTTPS</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          Private HTTPS requires platform listener and guest CA qualification. A passed binding
          canary is narrower than application health.
        </p>
        {message && <p role="alert">{message}</p>}
        <Button disabled={busy || !choices.data} busy={busy} onClick={() => void reviewPolicy()}>
          Review service policy
        </Button>
        {review && (
          <div className="space-y-2 rounded border border-border p-3">
            <p className="font-medium">Review replacement policy</p>
            <p>
              Target callers:{' '}
              {review.patch.allowed_service_callers === null
                ? 'same-account access'
                : review.patch.allowed_service_callers?.length
                  ? review.patch.allowed_service_callers.join(', ')
                  : 'no internal callers'}
              .
            </p>
            <p>
              Scoped grants:{' '}
              {review.patch.allowed_service_call_scopes === null
                ? 'cleared'
                : Object.keys(review.patch.allowed_service_call_scopes ?? {}).length
                  ? 'named map'
                  : 'deny all'}
              .
            </p>
            <p>
              Outbound targets: {review.patch.service_binding_targets?.join(', ') || 'none'};
              reachability {review.patch.service_binding_policy}; transport{' '}
              {review.patch.service_binding_transport}.
            </p>
            {review.forwardTargets.length > 0 && (
              <p>
                Future targets: {review.forwardTargets.join(', ')}. Calls cannot succeed until these
                apps exist.
              </p>
            )}
            <Button disabled={busy} busy={busy} onClick={() => void savePolicy()}>
              Save service policy
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
