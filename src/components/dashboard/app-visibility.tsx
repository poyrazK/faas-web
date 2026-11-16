import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FIELD, Select } from '@/components/ui/field';
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
  const [desired, setDesired] = useState<'public' | 'internal'>(app.visibility ?? 'public');
  const [review, setReview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const current = useRef({ accountId, slug, appId: app.id });
  const alive = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    current.current = { accountId, slug, appId: app.id };
  }, [accountId, slug, app.id]);
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
      title="Who can reach it"
      help="App visibility. Public: the platform URL and custom domains serve it, and other apps can call it. Internal: only the internal service answers, so public URLs stop serving it."
    >
      <div className="flex flex-col items-start gap-3 text-sm">
        {app.visibility && (
          <p className="text-muted-foreground" title={`visibility: ${app.visibility}`}>
            {app.visibility === 'internal'
              ? 'Now: internal only, so public URLs don’t serve it.'
              : 'Now: public, and other apps can call it too.'}
          </p>
        )}
        {!available && (
          <p role="status">Visibility changes require confirmed private-app capability access.</p>
        )}
        <label className="flex w-full flex-col gap-1.5 sm:max-w-md">
          <span className="label-mono text-muted-foreground">Visibility</span>
          <Select
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
          </Select>
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
          <div className="well w-full space-y-2 rounded-xl bg-muted/40 p-4">
            {desired === 'internal' ? (
              <p>
                Public platform URLs and custom domains will stop serving this app, and existing
                public links will fail.
              </p>
            ) : (
              <p>Public URLs serve this app again once routing accepts the change.</p>
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
