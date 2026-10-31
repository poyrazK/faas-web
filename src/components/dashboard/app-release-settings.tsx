import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { api, unwrap } from '@/lib/api/client';
import { useCapability } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useUpdateApp, type App } from '@/lib/api/queries';
import { CAPABILITY_LABELS } from '@/lib/capability-state';
import { Panel } from './primitives';

/**
 * How a production release reaches traffic: `release_policy`,
 * `release_probe_paths` and, for functions, `function_concurrency`.
 *
 * Its own panel and its own PATCH rather than more rows in the Runtime form:
 * these apply from the next deploy, not live, so they never ride along with
 * a runtime save and its convergence receipt.
 *
 * apid gates `release_policy=safe` and any probe path behind the
 * progressive-rollouts capability (faas pkg/productcap/catalog.json:4279);
 * fast and immediate, and function concurrency (autoscaling, GA), are not.
 */

type Policy = 'safe' | 'fast' | 'immediate';

// One line each, from faas pkg/api/appmanifest.go:292 and docs/deploys.md.
const POLICIES: { value: Policy; line: string }[] = [
  {
    value: 'safe',
    line: 'Canary at 1%, 10%, 50%, then 100%, advancing on clean evidence. A 5xx regression rolls back.',
  },
  {
    value: 'fast',
    line: 'Canary at 5%, 50%, then 100%, a minute each, with the same automatic rollback.',
  },
  {
    value: 'immediate',
    line: 'All traffic moves at once. No canary, no probes, and no stage for a release approval.',
  },
];

// apid's ValidProbePath and ReleaseProbePathsMax (faas pkg/api/appmanifest.go:323,
// pkg/api/limits.go:13251), so a refused list never leaves the browser.
const MAX_PROBE_PATHS = 3;
const MAX_PROBE_PATH_BYTES = 240;

function probePathsError(paths: string[]): string | undefined {
  if (paths.length > MAX_PROBE_PATHS) return `At most ${MAX_PROBE_PATHS} paths.`;
  const bad = paths.find(
    (p) =>
      !p.startsWith('/') ||
      new TextEncoder().encode(p).length > MAX_PROBE_PATH_BYTES ||
      /[?#*\\{}\s]/.test(p)
  );
  if (bad)
    return `${bad}: use a concrete path starting with /, with no query, wildcard or {parameter}.`;
  const twice = paths.find((p, i) => paths.indexOf(p) !== i);
  if (twice) return `${twice} is listed twice.`;
  return undefined;
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

type Draft = { policy: Policy; paths: string; concurrency: number };

function draftFrom(app: App): Draft {
  return {
    // apid reports the effective policy; the unset value is safe.
    policy: app.release_policy ?? 'safe',
    paths: (app.release_probe_paths ?? []).join('\n'),
    // 0 and 1 both mean one request per worker.
    concurrency: Math.max(app.function_concurrency ?? 1, 1),
  };
}

const NON_REQUEST_MODES = new Set(['service', 'worker', 'job']);

/**
 * An app with a release-approval policy must deploy to production through a
 * canary (faas approval/approval.go:246); immediate removes the canary, so
 * every deploy, GitHub pushes included, is refused with
 * release_approval_canary_required (release_freezes.go:342-349). apid still
 * accepts the setting, so the console asks first. No policy (404) needs no
 * question; an unreadable one is asked about in conditional terms.
 */
async function confirmImmediate(slug: string, confirm: ReturnType<typeof useConfirm>) {
  let policy: 'present' | 'absent' | 'unknown';
  try {
    await unwrap(
      api.GET('/v1/apps/{slug}/release-approval-policy', { params: { path: { slug } } })
    );
    policy = 'present';
  } catch (err) {
    // No policy, or approvals not released to this account (capgate's not_found).
    policy =
      err instanceof ApiError &&
      (err.code === 'release_approval_policy_not_found' || err.code === 'not_found')
        ? 'absent'
        : 'unknown';
  }
  if (policy === 'absent') return true;
  return confirm({
    title: 'Switch to immediate?',
    description:
      policy === 'present'
        ? `${slug} requires release approvals, which need a canary. With immediate there is none, so every production deploy, GitHub pushes included, is refused until the approval policy is removed or a deploy asks for a rollout.`
        : `If ${slug} requires release approvals, every production deploy will be refused with immediate, because approvals need a canary. The approval policy could not be read to check.`,
    confirmLabel: 'Switch to immediate',
    destructive: true,
  });
}

export function AppReleaseSettings({ app }: { app: App }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const update = useUpdateApp(app.slug);
  const rollouts = useCapability('progressive-rollouts');
  const rolloutsOn = rollouts.state === 'available';
  const [draft, setDraft] = useState<Draft>(() => draftFrom(app));
  const [failure, setFailure] = useState('');
  const isFunction = app.type === 'function';
  const bound = app.concurrency_per_vm;
  const mode = app.manifest?.execution_mode;

  // Only what changed goes over the wire, as on the Runtime form.
  const changes = useMemo(() => {
    const base = draftFrom(app);
    const out: {
      release_policy?: Policy;
      release_probe_paths?: string[];
      function_concurrency?: number;
    } = {};
    if (draft.policy !== base.policy) out.release_policy = draft.policy;
    const paths = lines(draft.paths);
    if (paths.join('\n') !== lines(base.paths).join('\n')) out.release_probe_paths = paths;
    if (isFunction && draft.concurrency !== base.concurrency)
      out.function_concurrency = draft.concurrency;
    return out;
  }, [app, draft, isFunction]);

  const pathsError = probePathsError(lines(draft.paths));
  const concurrencyError =
    isFunction && (draft.concurrency < 1 || draft.concurrency > bound)
      ? `Between 1 and ${bound} on your plan.`
      : undefined;
  const dirty = Object.keys(changes).length > 0;
  const blocked = Boolean(pathsError || concurrencyError);

  const save = async () => {
    if (!dirty || blocked || update.isPending) return;
    setFailure('');
    if (changes.release_policy === 'immediate' && !(await confirmImmediate(app.slug, confirm)))
      return;
    void update
      .mutateAsync(changes)
      .then((next) => {
        setDraft(draftFrom(next));
        toast({
          kind: 'success',
          title: 'Release settings saved',
          description:
            'function_concurrency' in changes
              ? 'Function concurrency applies from the next deploy.'
              : 'The next production release uses them.',
        });
      })
      .catch((err: unknown) => {
        // The registry said yes and apid said no: read availability again.
        if (err instanceof ApiError && err.code === 'capability_not_released') rollouts.refresh();
        setFailure(errorMessage(err));
      });
  };

  return (
    <Panel
      title="Releases"
      description="How a production release reaches traffic when the deploy names no rollout."
      actions={
        <Button
          size="sm"
          disabled={!dirty || blocked}
          busy={update.isPending}
          onClick={() => void save()}
        >
          Save release settings
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        {failure && (
          <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
            {failure}
          </p>
        )}
        {!rolloutsOn && (
          <p role="status" className="text-xs text-muted-foreground">
            Progressive rollouts: {CAPABILITY_LABELS[rollouts.state].toLowerCase()}. Choosing safe
            or setting probe paths needs it; fast and immediate do not.
          </p>
        )}

        <div role="group" aria-label="Release policy" className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Release policy</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {POLICIES.map(({ value, line }) => {
              const selected = draft.policy === value;
              // Gated only when it would newly turn safe on.
              const gated = value === 'safe' && !rolloutsOn && app.release_policy !== 'safe';
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  disabled={gated}
                  onClick={() => setDraft((d) => ({ ...d, policy: value }))}
                  className={`pressable flex flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? 'border-brand bg-brand/10 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="font-mono text-xs text-foreground">{value}</span>
                  <span className="text-xs leading-relaxed">{line}</span>
                </button>
              );
            })}
          </div>
          <span className="text-xs text-muted-foreground">
            Applies to an app that already serves traffic. First deploys, previews and named
            environments keep their own rollout, and one deploy can override it with{' '}
            <code className="font-mono">gregale deploy --rollout</code>. Also set with{' '}
            <code className="font-mono">gregale app {app.slug} --release-policy</code>.
          </span>
          {mode && NON_REQUEST_MODES.has(mode) && (
            <span className="text-xs" style={{ color: 'var(--status-warning)' }}>
              This app runs in {mode} mode, so the default rollout does not apply to it.
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="release-probe-paths" className="label-mono text-muted-foreground">
            Rollout probe paths
          </label>
          <textarea
            id="release-probe-paths"
            value={draft.paths}
            onChange={(e) => setDraft((d) => ({ ...d, paths: e.target.value }))}
            disabled={!rolloutsOn}
            rows={3}
            spellCheck={false}
            placeholder={'/healthz\n/api/orders'}
            {...fieldErrorProps(pathsError, 'release-probe-paths-error')}
            className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-brand/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[color:var(--status-critical)]"
          />
          {pathsError && <FieldError id="release-probe-paths-error">{pathsError}</FieldError>}
          <span className="text-xs text-muted-foreground">
            {draft.policy === 'immediate'
              ? 'Not used while the policy is immediate. '
              : 'While traffic is too quiet to judge, the rollout sends GET requests to these paths on both revisions instead of /. '}
            One per line, up to {MAX_PROBE_PATHS}; empty probes /. Also set with{' '}
            <code className="font-mono">gregale app {app.slug} --release-probe-paths</code>.
          </span>
        </div>

        {isFunction && (
          <div className="flex flex-col gap-1.5 sm:max-w-md">
            <label htmlFor="function-concurrency" className="label-mono text-muted-foreground">
              Function concurrency
            </label>
            <input
              id="function-concurrency"
              type="number"
              min={1}
              max={bound}
              value={draft.concurrency}
              onChange={(e) =>
                setDraft((d) => ({ ...d, concurrency: Math.trunc(Number(e.target.value)) || 0 }))
              }
              {...fieldErrorProps(concurrencyError, 'function-concurrency-error')}
              className={`${FIELD} w-full [font-variant-numeric:tabular-nums]`}
            />
            {concurrencyError && (
              <FieldError id="function-concurrency-error">{concurrencyError}</FieldError>
            )}
            <span className="text-xs text-muted-foreground">
              Requests one Node or Python worker serves at once, up to {bound} on your plan. Applies
              from the next deploy. A <code className="font-mono">concurrency:</code> in this
              function&apos;s <code className="font-mono">functions:</code> entry in gregale.yaml
              replaces it on <code className="font-mono">gregale deploy</code>.
            </span>
          </div>
        )}
      </div>
    </Panel>
  );
}
