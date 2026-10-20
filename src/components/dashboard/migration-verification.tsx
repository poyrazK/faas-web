import { MigrationCutover } from './migration-cutover';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Panel } from './primitives';
import { ApiError } from '@/lib/api/errors';
import {
  cancelMigrationVerification,
  createMigrationVerification,
  listMigrationVerifications,
  type MigrationVerification as Verification,
} from '@/lib/api/migration-verification';
import type { components } from '@/lib/api/schema';

const FIELD = 'h-10 rounded-lg border border-border bg-background px-3 text-sm';
const PHASE: Record<Verification['phase'], string> = {
  dependencies: 'Checking dependencies from your deployment',
  startup: 'Checking the deployed HTTP route',
  park: 'Parking the Gregale service',
  drain: 'Waiting for all serving instances to drain',
  wake: 'Requesting a wake',
  waking: 'Waiting for the selected deployment to resume',
  cold_smoke: 'Checking HTTP after wake',
  cold_dependencies: 'Repeating dependency checks after wake',
  restoring: 'Stopping checks and recovering the Gregale service',
  complete: 'Verification complete',
};
const REASON: Record<string, string> = {
  verification_retrying:
    'The server is retrying this step after a temporary infrastructure failure.',
  waiting_for_current_runtime:
    'Waiting for the deployed instances to use current configuration. If this persists, refresh the app’s runtime configuration from its settings.',
  verification_state_changed:
    'The deployment or runtime state changed during verification. Review the app and start a new verification.',
  dependency_failed:
    'A dependency check failed. Review its variables and permissions, then start a new verification.',
  smoke_failed:
    'The selected HTTP path did not return a successful response. Check the route and application logs.',
  deployment_or_configuration_changed:
    'The deployment or configuration changed. Start a new verification for the current version.',
  deployment_changed:
    'This deployment is no longer current. Open the app to choose its current version.',
  runtime_configuration_not_current:
    'A serving instance has older configuration. Refresh its runtime configuration before verifying again.',
  service_connection_target_changed:
    'A connected service or its deployment changed. Review the saved migration and start a new verification.',
  verification_deadline_exceeded:
    'Checks reached their ten-minute deadline. The server stops outstanding tasks and recovers any service this run parked.',
  verification_cancelled: 'Verification was cancelled. Completed checks remain in this report.',
  account_inactive: 'Verification stopped because the account cannot currently run workloads.',
  app_deleted: 'Verification stopped because the app was deleted.',
  verification_disabled: 'Verification stopped because this host disabled task admission.',
  security_posture_blocked: 'Verification stopped because the deployment is security quarantined.',
};
const CHECK_LABEL: Record<string, string> = {
  'startup/postgres': 'PostgreSQL at startup',
  'after_wake/postgres': 'PostgreSQL after wake',
  'startup/object_storage': 'Storage at startup',
  'after_wake/object_storage': 'Storage after wake',
  'startup/external_api': 'External API at startup',
  'after_wake/external_api': 'External API after wake',
  'startup/dependencies': 'Dependencies at startup',
  'after_wake/dependencies': 'Dependencies after wake',
  startup: 'HTTP at startup',
  cold_wake: 'Cold wake',
  cold_smoke: 'HTTP after wake',
};
type VerificationForm = {
  sourceID?: string;
  postgres: string;
  storage: string;
  external: string;
  path: string;
  coldWake: boolean;
};

export function MigrationVerification({
  app,
  deployment,
  serviceConnections = [],
}: {
  app: string;
  deployment: string;
  serviceConnections?: components['schemas']['MigrationServiceConnectionCheck'][];
}) {
  const qc = useQueryClient();
  const key = ['migration-verifications', app] as const;
  const reports = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listMigrationVerifications(app, signal),
    retry: false,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.runs.some((item) => item.status === 'pending') ? 1500 : false,
  });
  const [selected, setSelected] = useState<string>();
  const [draft, setDraft] = useState<VerificationForm>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [cancellationUncertain, setCancellationUncertain] = useState<string>();
  const submitting = useRef(false);
  const run = selected
    ? reports.data?.runs.find((item) => item.id === selected)
    : (reports.data?.runs.find((item) => item.status === 'pending') ??
      reports.data?.runs.find((item) => item.deployment_id === deployment));
  const matchesConnections =
    !serviceConnections.length ||
    JSON.stringify(run?.request.checks.service_connections ?? []) ===
      JSON.stringify(serviceConnections);
  const form =
    draft && draft.sourceID === run?.id
      ? draft
      : {
          sourceID: run?.id,
          path: run?.request.smoke_path ?? '/',
          postgres: run?.request.checks.postgres_env_key ?? '',
          storage: run?.request.checks.object_storage_prefix ?? '',
          external: run?.request.checks.http_env_key ?? '',
          coldWake: run?.request.cold_wake ?? true,
        };
  const { postgres, storage, external, path, coldWake } = form;
  const needsCancelRecovery =
    cancellationUncertain === run?.id && run?.status === 'pending' && !run.cancel_requested_at;
  const updateForm = (patch: Partial<VerificationForm>) => setDraft({ ...form, ...patch });

  function save(next: Verification) {
    qc.setQueryData(key, (old: { runs: Verification[] } | undefined) => ({
      runs: [next, ...(old?.runs ?? []).filter((item) => item.id !== next.id)],
    }));
  }

  async function start() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    const id = crypto.randomUUID();
    try {
      const next = await createMigrationVerification(app, {
        id,
        deployment_id: deployment,
        smoke_path: path,
        cold_wake: coldWake,
        checks: {
          ...(postgres.trim() ? { postgres_env_key: postgres.trim() } : {}),
          ...(storage.trim() ? { object_storage_prefix: storage.trim() } : {}),
          ...(external.trim() ? { http_env_key: external.trim() } : {}),
          ...(serviceConnections.length ? { service_connections: serviceConnections } : {}),
        },
      });
      save(next);
      setSelected(next.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'validation_failed') {
        setError(err.message);
      } else if (err instanceof ApiError && err.code === 'not_implemented') {
        setError('Verification is not available on this Gregale host yet.');
      } else {
        setCreationUncertain(true);
        setError(
          'Could not confirm verification creation. Reload saved reports before starting another run.'
        );
        const recovered = await reports.refetch();
        if (!recovered.isError && recovered.data?.runs.some((item) => item.id === id)) {
          setSelected(id);
          setCreationUncertain(false);
          setError(undefined);
        }
      }
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  async function cancel() {
    if (!run || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      save(await cancelMigrationVerification(app, run.id));
      setCancellationUncertain(undefined);
    } catch {
      setCancellationUncertain(run.id);
      void reports.refetch();
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  return (
    <>
      <Panel
        title="Verify your migration"
        description="Test the Gregale service before switching production traffic. Choose a read-only route that exercises your application and its dependencies."
      >
        {reports.isPending ? (
          <p role="status">Loading saved verification reports…</p>
        ) : reports.isError && !reports.data ? (
          <p role="alert">Saved reports could not be loaded.</p>
        ) : (
          <>
            {run && (
              <div className="mb-5 space-y-3" aria-label="Migration verification report">
                <p role="status" className="font-medium">
                  {run.status === 'passed' && !matchesConnections
                    ? 'Saved checks use different service connections. Run verification again.'
                    : run.status === 'passed'
                      ? 'Checks passed for this deployment'
                      : run.status === 'pending'
                        ? run.cancel_requested_at && run.phase !== 'restoring'
                          ? 'Cancelling verification'
                          : PHASE[run.phase]
                        : `Verification ${run.status}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Deployment {run.deployment_id} · Configuration{' '}
                  {run.configuration_revision.slice(0, 12)}
                </p>
                {run.status === 'pending' && (
                  <p className="text-sm text-muted-foreground">
                    Checks continue on the server. You can close this page and return to the saved
                    report.
                  </p>
                )}
                {run.recovery_status && (
                  <p
                    role={run.recovery_status === 'blocked' ? 'alert' : 'status'}
                    className="text-sm"
                  >
                    {run.recovery_status === 'restored'
                      ? 'The Gregale service is running again.'
                      : run.recovery_status === 'superseded'
                        ? 'A different deployment now controls this app. Recovery left the new deployment in control.'
                        : run.recovery_status === 'blocked'
                          ? 'Service recovery is blocked by an account or security restriction. Review the app before continuing.'
                          : 'Recovering the Gregale service. A wake request is not yet proof that it is running.'}
                  </p>
                )}
                {run.status === 'pending' &&
                  !run.cancel_requested_at &&
                  run.phase !== 'restoring' && (
                    <Button
                      variant="outline"
                      busy={busy}
                      disabled={busy}
                      onClick={() => void cancel()}
                    >
                      Cancel verification
                    </Button>
                  )}
                {!run.request.cold_wake && (
                  <p className="text-sm text-muted-foreground">Cold wake was not checked.</p>
                )}
                {!Object.values(run.request.checks).some(Boolean) && (
                  <p className="text-sm text-muted-foreground">
                    No dependency checks were selected. This report covers the HTTP route.
                  </p>
                )}
                {run.reason && (
                  <p role="alert" className="text-sm">
                    {REASON[run.reason] ??
                      'Open the app to review this verification’s runtime state.'}
                  </p>
                )}
                <ul className="space-y-2 text-sm">
                  {run.checks.map((check) => (
                    <li key={check.name}>
                      <span className="font-medium">
                        {CHECK_LABEL[check.name] ??
                          (check.name.includes('/service/')
                            ? `${check.name.startsWith('after_wake/') ? 'After wake' : 'Startup'} connection ${check.name.split('/service/')[1]}`
                            : 'Verification check')}
                        : {check.status}
                      </span>
                      <p className="text-muted-foreground">{check.detail}</p>
                    </li>
                  ))}
                </ul>
                {run.status !== 'pending' && (
                  <a
                    className="text-sm text-brand underline"
                    download={`migration-${run.id}.json`}
                    href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(run, null, 2))}`}
                  >
                    Download verification report
                  </a>
                )}
              </div>
            )}
            {(!run || run.status !== 'pending') && (
              <fieldset disabled={busy} className="space-y-4">
                <legend className="sr-only">Migration verification checks</legend>
                {!!serviceConnections.length && (
                  <div className="space-y-2 text-sm">
                    <p>Saved runtime connections will be checked from this deployment:</p>
                    {serviceConnections.map((c) => (
                      <p key={c.env_key} className="text-xs text-muted-foreground">
                        {c.env_key} → {c.service} · target deployment {c.deployment_id}
                      </p>
                    ))}
                  </div>
                )}
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono">HTTP smoke test path</span>
                  <input
                    className={FIELD}
                    aria-label="HTTP smoke test path"
                    value={path}
                    onChange={(event) => updateForm({ path: event.target.value })}
                    placeholder="/ready"
                  />
                  <span className="text-xs text-muted-foreground">
                    GET must return 2xx. Queries, credentials and external URLs are not accepted.
                  </span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono">PostgreSQL environment key (optional)</span>
                  <input
                    className={FIELD}
                    aria-label="PostgreSQL environment key (optional)"
                    value={postgres}
                    onChange={(event) => updateForm({ postgres: event.target.value })}
                    placeholder="DATABASE_URL"
                  />
                  <span className="text-xs text-muted-foreground">
                    Uses the saved value for an authenticated connection and read-only SELECT 1.
                  </span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono">Object storage variable prefix (optional)</span>
                  <input
                    className={FIELD}
                    aria-label="Object storage variable prefix (optional)"
                    value={storage}
                    onChange={(event) => updateForm({ storage: event.target.value })}
                    placeholder="ASSETS"
                  />
                  <span className="text-xs text-muted-foreground">
                    Uses the existing S3 binding variables for a read-only listing.
                  </span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono">External API URL environment key (optional)</span>
                  <input
                    className={FIELD}
                    aria-label="External API URL environment key (optional)"
                    value={external}
                    onChange={(event) => updateForm({ external: event.target.value })}
                    placeholder="PARTNER_HEALTH_URL"
                  />
                  <span className="text-xs text-muted-foreground">
                    Uses the saved HTTPS URL for a GET; requires 2xx and rejects redirects.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={coldWake}
                    onChange={(event) => updateForm({ coldWake: event.target.checked })}
                  />
                  <span>
                    Also verify after cold wake. This briefly parks and wakes this Gregale service.
                    Keep production traffic with your current provider while testing.
                  </span>
                </label>
                <Button
                  busy={busy}
                  disabled={
                    busy ||
                    creationUncertain ||
                    !path.startsWith('/') ||
                    path.startsWith('//') ||
                    /[?#]/.test(path)
                  }
                  onClick={() => void start()}
                >
                  {run ? 'Run verification again' : 'Start verification'}
                </Button>
              </fieldset>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm">
            {error}
          </p>
        )}
        {reports.isError && reports.data && (
          <p role="alert" className="mt-3 text-sm">
            The report could not refresh. Verification continues on the server.
          </p>
        )}
        {needsCancelRecovery && (
          <p role="alert" className="mt-3 text-sm">
            Could not confirm cancellation. Reload the report; verification continues on the server
            until cancellation is saved.
          </p>
        )}
        {(reports.isError || creationUncertain || error || needsCancelRecovery) && (
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => {
              void reports.refetch().then((result) => {
                if (!result.isError) {
                  setError(undefined);
                  setCreationUncertain(false);
                }
              });
            }}
          >
            Reload reports
          </Button>
        )}
      </Panel>
      <MigrationCutover
        app={app}
        deployment={deployment}
        verification={matchesConnections ? run : undefined}
      />
    </>
  );
}
