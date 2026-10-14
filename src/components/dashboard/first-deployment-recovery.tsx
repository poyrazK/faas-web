import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp, useDeployment } from '@/lib/api/queries';
import { isDeploymentTerminal } from '@/lib/deployment-status';
import { Button } from '@/components/ui/button';
import { PageHeader } from './primitives';
import { DeploymentProgress } from './deployment-progress';
import { DeploymentLifecycle } from './deployment-lifecycle';
import type { DeploymentRecoveryContext } from './new-app-source';
import { RecoverySourceForm } from './recovery-source-form';
import { resourceId } from '@/lib/resource-id';

/** Resolve every saved pointer against the account before offering mutations. */
export function FirstDeploymentRecovery({
  recovery,
  onChange,
  submitting = false,
  submissionError,
}: {
  recovery: DeploymentRecoveryContext;
  onChange: (next: DeploymentRecoveryContext) => void;
  submitting?: boolean;
  submissionError?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const app = useApp(recovery.app);
  const attempt = useDeployment(recovery.deployment ?? '', {
    refetchInterval: (query) => (isDeploymentTerminal(query.state.data?.status) ? false : 2500),
  });
  if (app.isPending || (recovery.deployment && attempt.isPending))
    return <p role="status">Restoring your deployment…</p>;
  if (app.isError || !app.data || (recovery.deployment && (attempt.isError || !attempt.data)))
    return (
      <div role="alert" className="space-y-3">
        <p>
          We could not verify this app and deployment. Your saved configuration has not been
          changed.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            void app.refetch();
            if (recovery.deployment) void attempt.refetch();
          }}
        >
          Refresh recovery
        </Button>
      </div>
    );
  if (recovery.deployment && attempt.data?.app_id !== app.data.id)
    return (
      <p role="alert">
        This deployment does not belong to this app. Open the app’s deployment history to choose the
        correct attempt.
      </p>
    );

  const uncertain =
    recovery.phase === 'unknown' ||
    (!submitting && !sourceBusy && !retryBusy && recovery.phase === 'submitting') ||
    (!submitting && !sourceBusy && !recovery.deployment && recovery.phase !== 'rejected');
  const failed = recovery.deployment && attempt.data?.status === 'failed';
  const canRecover =
    !submitting &&
    !uncertain &&
    (failed || (!recovery.deployment && recovery.phase === 'rejected'));
  const code = attempt.data?.error_code;
  const configTab =
    code === 'env_var_missing'
      ? 'Env vars'
      : code === 'app_runtime_oom' || code === 'app_startup_timeout' || code === 'app_not_listening'
        ? 'Configuration'
        : undefined;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader
        title="Your first deployment"
        description="Your app is saved. Recovery creates another attempt, not another app."
      />
      <p className="text-sm text-muted-foreground">
        {app.data.slug} · {app.data.runtime ?? app.data.type} · {app.data.ram_mb} MB
      </p>
      {recovery.deployment || submitting ? (
        <DeploymentProgress
          appCreated
          appName={app.data.slug}
          deploymentId={recovery.deployment ?? null}
          repo={recovery.repo}
          sourceRef={recovery.ref}
          endpoint={app.data.url}
          hideRetryOptions
        />
      ) : (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-medium">
            {uncertain ? 'Check whether the deployment started' : 'Deployment was not submitted'}
          </h2>
          <p role="alert" className="mt-2 text-sm text-muted-foreground">
            {submissionError ?? 'The app is saved, but no confirmed deployment is selected.'}
          </p>
        </div>
      )}
      {uncertain && (
        <p role="alert" className="text-sm text-muted-foreground">
          The outcome is unknown. Check deployment history before starting another attempt. We will
          not automatically resend the request.
        </p>
      )}
      {failed && !uncertain && attempt.data && (
        <DeploymentLifecycle
          deployment={attempt.data}
          disabled={sourceBusy}
          onBusyChange={setRetryBusy}
          onRetryStateChange={(phase) => onChange({ ...recovery, phase })}
          retryLabel="Retry original deployment"
          onRetried={(next) => {
            if (!resourceId(next.id) || next.app_id !== app.data.id) {
              onChange({ ...recovery, phase: 'unknown' });
              return;
            }
            setEditing(false);
            onChange({ ...recovery, deployment: next.id, phase: undefined });
          }}
        />
      )}
      {canRecover && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Changed code or app settings? Deploy a fixed ref. Retrying the original attempt reuses
            its recorded inputs.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="cta"
              disabled={retryBusy || sourceBusy}
              onClick={() => setEditing(true)}
            >
              Deploy a fix
            </Button>
            {configTab && (
              <Link
                to="/dashboard/workflows/$workflowId"
                params={{ workflowId: recovery.app }}
                search={{ tab: configTab }}
                className="text-sm text-brand underline"
              >
                {configTab === 'Env vars'
                  ? 'Review environment variables'
                  : 'Review app configuration'}
              </Link>
            )}
            <Link
              to="/dashboard/settings"
              search={{ section: 'integrations' }}
              className="text-sm text-brand underline"
            >
              Review GitHub access
            </Link>
          </div>
        </div>
      )}
      {editing && (
        <RecoverySourceForm
          key={recovery.deployment ?? 'submission'}
          recovery={recovery}
          appId={app.data.id}
          allowed={Boolean(canRecover && !retryBusy)}
          onBusyChange={setSourceBusy}
          onChange={(next) => {
            if (next.deployment && next.deployment !== recovery.deployment) {
              setEditing(false);
              setSourceBusy(false);
            }
            onChange(next);
          }}
        />
      )}
      <Link
        to="/dashboard/workflows/$workflowId"
        params={{ workflowId: recovery.app }}
        search={{ tab: 'Deployments' }}
        className="text-sm text-brand underline"
      >
        Check deployment history
      </Link>
    </div>
  );
}
