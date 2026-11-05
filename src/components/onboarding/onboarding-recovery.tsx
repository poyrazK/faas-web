import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { api, unwrap } from '@/lib/api/client';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useApp, useDeployment, useDeployFunctionSourceFor, type App } from '@/lib/api/queries';
import { DeploymentProgress } from '@/components/dashboard/deployment-progress';
import { DeploymentLifecycle } from '@/components/dashboard/deployment-lifecycle';
import { FirstDeploymentRecovery } from '@/components/dashboard/first-deployment-recovery';
import { FUNCTION_STARTERS } from '@/lib/function-starters';
import { gzip, tarball } from '@/lib/tar';
import { sampleVersion, type OnboardingDraft, type OnboardingOwner } from '@/lib/onboarding-draft';
import { onboardingProgress } from '@/lib/onboarding-progress';
import { resourceId } from '@/lib/resource-id';
import { OnboardingSuccess } from './onboarding-success';
import { onboardingEvent } from '@/lib/onboarding-events';
import { markOnboarded } from '@/lib/auth';

export function OnboardingRecovery({
  owner,
  draft,
  plan,
  apps,
  inventoryUnavailable = false,
  onChange,
  onRefresh,
}: {
  owner: OnboardingOwner;
  draft: OnboardingDraft;
  plan?: string;
  apps: App[];
  inventoryUnavailable?: boolean;
  onChange: (draft: OnboardingDraft) => void;
  onRefresh: () => void;
}) {
  const app = useApp(
    draft.app ?? '',
    { enabled: Boolean(draft.app), retry: false, staleTime: 0, refetchOnMount: 'always' },
    owner.account
  );
  const deployment = useDeployment(
    draft.deployment ?? '',
    {
      enabled: Boolean(draft.deployment),
      retry: false,
      staleTime: 0,
      refetchOnMount: 'always',
      refetchInterval: (q) =>
        ['live', 'failed', 'cancelled', 'superseded'].includes(q.state.data?.status ?? '')
          ? false
          : 2500,
    },
    owner.account
  );
  const upload = useDeployFunctionSourceFor();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const progress = onboardingProgress({
    draft,
    app: app.data,
    deployment: deployment.data,
    loading: Boolean(
      (draft.app && (app.isPending || !app.isFetchedAfterMount)) ||
      (draft.deployment && (deployment.isPending || !deployment.isFetchedAfterMount))
    ),
    error: app.error ?? deployment.error,
  });
  const history = useQuery({
    queryKey: ['onboarding', owner.account, owner.workspace, draft.app, 'history'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/deployments', {
          params: { path: { slug: draft.app! }, query: { limit: 5 } },
          signal,
        })
      ),
    // Any outcome without a confirmed result reads the history, including a recovery
    // that saved an app but no deployment; a query left disabled would pend forever.
    enabled: Boolean(draft.app && progress === 'unknown' && draft.phase !== 'submitting'),
    retry: false,
  });
  const permitted = Boolean(draft.app && apps.some((a) => a.slug === draft.app));
  useEffect(() => {
    if (!permitted || inventoryUnavailable) return;
    // The flag-off dashboard checks the legacy marker; a confirmed live app counts.
    if (progress === 'live') markOnboarded();
    if (progress === 'live' || progress === 'failed')
      onboardingEvent(
        progress === 'live' ? 'deployment_live' : 'deployment_failed',
        { source: draft.kind, plan },
        { owner, app: draft.app, deployment: draft.deployment }
      );
  }, [
    permitted,
    inventoryUnavailable,
    progress,
    draft.kind,
    draft.app,
    draft.deployment,
    owner,
    plan,
  ]);
  const changed = (next: OnboardingDraft) => {
    onChange(next);
    onRefresh();
  };

  if (inventoryUnavailable && !busy)
    return (
      <div className="flex flex-col gap-4">
        <p role="alert">Confirm your current workspace apps before resuming this deployment.</p>
        <Button variant="outline" onClick={onRefresh}>
          Retry app lookup
        </Button>
      </div>
    );
  if (!draft.app)
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Check whether your app was created</h1>
        <p role="alert" className="text-sm text-muted-foreground">
          The request outcome is unknown. Check your app inventory before creating another app.
          Nothing will be resubmitted automatically.
        </p>
        {apps
          .filter((a) => a.slug === draft.name)
          .map((candidate) => (
            <div key={candidate.id} className="rounded-lg border border-border p-4">
              <p className="mb-3 font-mono text-sm">{candidate.slug}</p>
              <Button onClick={() => changed({ ...draft, app: candidate.slug, phase: 'unknown' })}>
                Inspect this saved app
              </Button>
            </div>
          ))}
        <Button variant="outline" onClick={onRefresh}>
          Refresh app inventory
        </Button>
        {!apps.some((a) => a.slug === draft.name) && (
          <Button
            variant="outline"
            onClick={async () => {
              if (
                (await confirm({
                  title: 'Return to setup?',
                  description:
                    'Check your app inventory first. If the original app appears later, resume it instead of creating another one.',
                  confirmLabel: 'Return to setup',
                })) &&
                mounted.current
              )
                changed({ ...draft, phase: 'preparing' });
            }}
          >
            I checked — return to setup
          </Button>
        )}
        <Link to="/dashboard/apps" className="text-sm text-brand underline">
          Open app inventory
        </Link>
      </section>
    );
  if (progress === 'unavailable')
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Restore your deployment</h1>
        <p
          role={app.error || deployment.error ? 'alert' : 'status'}
          className="text-sm text-muted-foreground"
        >
          {app.error || deployment.error
            ? 'We could not verify this app and deployment. Your saved progress is unchanged.'
            : 'Reading your app and deployment…'}
        </p>
        {Boolean(app.error || deployment.error) && (
          <Button
            variant="outline"
            onClick={() => {
              void app.refetch();
              if (draft.deployment) void deployment.refetch();
              onRefresh();
            }}
          >
            Retry status check
          </Button>
        )}
      </section>
    );
  if (progress === 'mismatch')
    return (
      <p role="alert">
        This deployment does not belong to this app. Review the app's deployment history.
      </p>
    );
  if (!permitted)
    return (
      <div className="flex flex-col gap-4">
        <p role="alert">This app has not been confirmed in your current account and workspace.</p>
        <Button variant="outline" onClick={onRefresh}>
          Refresh workspace apps
        </Button>
      </div>
    );
  if (progress === 'live')
    return (
      <OnboardingSuccess
        source={draft.kind}
        plan={plan}
        slug={draft.app}
        endpoint={app.data?.visibility === 'internal' ? null : app.data?.url}
      />
    );
  if (progress === 'unknown' && draft.phase !== 'submitting')
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Check your deployment outcome</h1>
        <p role="alert" className="text-sm text-muted-foreground">
          Your app is saved, but the latest submission or retry has no confirmed result. Select the
          actual attempt from history before continuing. No request will be resent automatically.
        </p>
        {history.isPending && <p role="status">Reading recent deployments…</p>}
        {history.error && <p role="alert">{errorMessage(history.error)}</p>}
        {history.data?.items
          .filter((d) => d.app_id === app.data?.id)
          .map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
            >
              <span className="text-xs">
                {d.status} · {new Date(d.created_at).toLocaleString()}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => changed({ ...draft, deployment: d.id, phase: 'accepted' })}
              >
                Use this deployment
              </Button>
            </div>
          ))}
        <Button
          variant="outline"
          onClick={() => {
            void history.refetch();
            onRefresh();
          }}
        >
          Refresh deployment history
        </Button>
        {!draft.deployment &&
          draft.kind !== 'existing' &&
          history.isSuccess &&
          !history.isFetching &&
          history.data.items.length === 0 && (
            <Button
              variant="outline"
              onClick={async () => {
                if (
                  (await confirm({
                    title: 'Prepare another submission?',
                    description:
                      'No deployment is listed yet. If the previous request is still completing, another submission may start an additional build. Nothing will be submitted until you click Deploy again.',
                    confirmLabel: 'Prepare submission',
                  })) &&
                  mounted.current
                )
                  changed({ ...draft, phase: 'rejected' });
              }}
            >
              Prepare another submission
            </Button>
          )}
        <Link
          to="/dashboard/apps/$appSlug"
          params={{ appSlug: draft.app }}
          search={{ tab: 'Deployments' }}
          className="text-sm text-brand underline"
        >
          Inspect app history
        </Link>
      </section>
    );
  if (draft.kind === 'git')
    return (
      <FirstDeploymentRecovery
        accountId={owner.account}
        recovery={{
          app: draft.app,
          repo: draft.repo,
          ref: draft.ref,
          ...(draft.deployment ? { deployment: draft.deployment } : {}),
          ...(draft.phase === 'rejected' ? { phase: 'rejected' as const } : {}),
        }}
        onChange={(r) => changed({ ...draft, ...r, phase: r.phase ?? 'accepted' })}
      />
    );
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">Your first deployment</h1>
      {draft.phase === 'submitting' && <p role="status">Submitting your deployment…</p>}
      {draft.deployment && (
        <DeploymentProgress
          accountId={owner.account}
          appCreated
          appName={draft.app}
          appSlug={draft.app}
          deploymentId={draft.deployment}
          endpoint={app.data?.visibility === 'internal' ? null : app.data?.url}
          source={{
            kind: 'upload',
            label: draft.kind === 'sample' ? 'Node.js sample' : 'Saved source',
          }}
          hideRetryOptions
        />
      )}
      {deployment.data?.status === 'failed' && (
        <DeploymentLifecycle
          deployment={deployment.data}
          retryLabel="Retry original deployment"
          onBusyChange={setBusy}
          onRetryStateChange={(phase) => onChange({ ...draft, phase })}
          onRetried={(next) =>
            changed({
              ...draft,
              ...(resourceId(next.id) && next.app_id === app.data?.id
                ? { deployment: next.id, phase: 'accepted' as const }
                : { phase: 'unknown' as const }),
            })
          }
        />
      )}
      {!draft.deployment &&
        draft.phase === 'rejected' &&
        draft.kind === 'sample' &&
        draft.starter === sampleVersion() && (
          <>
            <p role="alert" className="text-sm text-muted-foreground">
              The sample was not submitted. Your app is saved; you can submit the sample to this
              same app.
            </p>
            <Button
              busy={busy}
              onClick={async () => {
                if (
                  locked.current ||
                  !app.data ||
                  app.data.type !== 'function' ||
                  !FUNCTION_STARTERS.node.runtimes.includes(app.data.runtime as 'node22' | 'node24')
                )
                  return;
                if (
                  !(await confirm({
                    title: 'Submit the sample to this app?',
                    description:
                      'Deploy the sample in the saved app using its current runtime. No new app is created.',
                    confirmLabel: 'Deploy sample',
                  }))
                )
                  return;
                if (!mounted.current) return;
                locked.current = true;
                setBusy(true);
                setFailure(null);
                try {
                  const starter = FUNCTION_STARTERS.node;
                  const archive = await gzip(
                    tarball([{ name: starter.filename, content: starter.code }, ...starter.extra])
                  );
                  if (!mounted.current) return;
                  onChange({ ...draft, phase: 'submitting' });
                  const next = await upload.mutateAsync({
                    slug: draft.app!,
                    archive,
                    runtime: app.data.runtime!,
                  });
                  if (!mounted.current) return;
                  changed({
                    ...draft,
                    ...(resourceId(next.id) && next.app_id === app.data.id
                      ? { deployment: next.id, phase: 'accepted' as const }
                      : { phase: 'unknown' as const }),
                  });
                } catch (error) {
                  if (!mounted.current) return;
                  setFailure(errorMessage(error));
                  onChange({
                    ...draft,
                    phase: error instanceof ApiError && error.status < 500 ? 'rejected' : 'unknown',
                  });
                } finally {
                  locked.current = false;
                  if (mounted.current) setBusy(false);
                }
              }}
            >
              Deploy sample to saved app
            </Button>
          </>
        )}
      {failure && <p role="alert">{failure}</p>}
      {!draft.deployment && draft.kind === 'sample' && draft.starter !== sampleVersion() && (
        <p role="alert">
          This sample version has changed. Open the app to review its history before deploying
          different source.
        </p>
      )}
      <Link
        to="/dashboard/apps/$appSlug"
        params={{ appSlug: draft.app }}
        search={{ tab: 'Deployments' }}
        className="text-sm text-brand underline"
      >
        View deployment history
      </Link>
    </section>
  );
}
