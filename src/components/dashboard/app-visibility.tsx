import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { useCapability } from '@/lib/api/capabilities';
import { patchAppVisibility, readAppVisibilityContext } from '@/lib/api/bindings';
import { keys, type App } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import { errorMessage } from '@/lib/api/errors';
import { Panel } from './primitives';

type Plan = components['schemas']['CapabilitiesResponse']['plan'];
const fingerprint = (app: App) => JSON.stringify([app.id, app.visibility, app.url]);

export function AppVisibility({
  accountId,
  plan,
  slug,
  app,
}: {
  accountId: string;
  plan: Plan;
  slug: string;
  app: App;
}) {
  const capability = useCapability('private-apps');
  const cache = useQueryClient();
  const [desired, setDesired] = useState<'public' | 'internal'>(app.visibility);
  const [review, setReview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const current = useRef({ accountId, slug, appId: app.id });
  const alive = useRef(true);
  const pending = useRef<AbortController | null>(null);
  current.current = { accountId, slug, appId: app.id };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);
  const available = capability.accountId === accountId && capability.state === 'available';
  const stillHere = (before: typeof current.current) =>
    alive.current &&
    before.accountId === current.current.accountId &&
    before.slug === current.current.slug &&
    before.appId === current.current.appId;

  async function reviewChange() {
    if (!available || desired === app.visibility || busy) return;
    const before = { ...current.current };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const fresh = await readAppVisibilityContext(accountId, slug, plan, controller.signal);
      if (!stillHere(before)) return;
      if (fingerprint(fresh) !== fingerprint(app)) {
        setMessage('The app changed while you were reviewing visibility. Reload and review again.');
        await cache.invalidateQueries({ queryKey: ['apps', 'account', accountId, slug] });
        return;
      }
      setReview(fingerprint(fresh));
    } catch (error) {
      if (stillHere(before) && !controller.signal.aborted) setMessage(errorMessage(error));
    } finally {
      if (stillHere(before)) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  async function save() {
    if (!review || !available || busy) return;
    const before = { ...current.current };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const fresh = await readAppVisibilityContext(accountId, slug, plan, controller.signal);
      if (!stillHere(before)) return;
      if (fingerprint(fresh) !== review) {
        setReview(null);
        setMessage('The app changed since review. Review the latest visibility again.');
        await cache.invalidateQueries({ queryKey: ['apps', 'account', accountId, slug] });
        return;
      }
      const next = await patchAppVisibility(slug, desired, controller.signal);
      if (!stillHere(before)) return;
      setReview(null);
      if (next.visibility === desired) {
        setDesired(next.visibility);
        setMessage(
          `Visibility change accepted: ${next.visibility}. Routing verification is separate.`
        );
      } else {
        setMessage(
          'Visibility response did not confirm the requested state. Refresh before another edit.'
        );
      }
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['apps', 'account', accountId, slug] }),
        cache.invalidateQueries({ queryKey: keys.apps }),
      ]);
    } catch (error) {
      if (stillHere(before) && !controller.signal.aborted) {
        setReview(null);
        setMessage(`Visibility was not confirmed. Refresh before retrying. ${errorMessage(error)}`);
      }
    } finally {
      if (stillHere(before)) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  return (
    <Panel
      title="App visibility"
      description="Public edge routing and internal service access are separate policies."
    >
      <div className="space-y-3 p-4 text-sm">
        <p>
          Reported visibility: <strong>{app.visibility}</strong>. Internal service routing and
          caller policy are shown in Connect → Services.
        </p>
        {!available && (
          <p role="status">Visibility changes require confirmed private-app capability access.</p>
        )}
        <label className="block space-y-1">
          <span>Visibility</span>
          <select
            aria-label="App visibility"
            className={FIELD}
            value={desired}
            disabled={!available || busy}
            onChange={(event) => {
              setDesired(event.target.value as 'public' | 'internal');
              setReview(null);
              setMessage('');
            }}
          >
            <option value="public">Public edge and internal service</option>
            <option value="internal">Internal service only</option>
          </select>
        </label>
        {message && <p role="alert">{message}</p>}
        <Button
          disabled={!available || busy || desired === app.visibility}
          busy={busy}
          onClick={() => void reviewChange()}
        >
          Review visibility
        </Button>
        {review && (
          <div className="space-y-2 rounded border border-border p-3">
            {desired === 'internal' ? (
              <p>
                Public platform URLs and custom domains will stop serving this app. Existing public
                links will fail. Authenticated same-account service callers remain subject to their
                caller policy.
              </p>
            ) : (
              <p>
                Public edge reachability will be restored when routing accepts the change. Verify
                domain and edge state separately.
              </p>
            )}
            <Button disabled={busy || !available} busy={busy} onClick={() => void save()}>
              Save visibility
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
