import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  getProjectMigration,
  listProjectMigrations,
  resumeProjectMigration,
  scanMigrationProject,
  type MigrationSource,
} from '@/lib/api/project-migration';
import { migrationEnvironment } from '@/lib/migration-environment';
import { isValidGitHubRepo, isValidGitRef } from './new-app-source';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { Button } from '@/components/ui/button';
import { FIELD, Textarea } from '@/components/ui/field';
import { Panel } from './primitives';
import { MigrationVerification } from './migration-verification';

const unfinished = (status: string) =>
  ['pending', 'failed', 'cancelled', 'superseded'].includes(status);
export function ProjectMigrationProgress({
  id,
  source,
  submissionError = '',
}: {
  id: string;
  source?: MigrationSource;
  submissionError?: string;
}) {
  const { account } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['project-migration', account?.id, id],
    queryFn: ({ signal }) => getProjectMigration(id, signal),
    enabled: !!account,
    refetchInterval: 5000,
    retry: false,
  });
  const [active, setActive] = useState('');
  const [repo, setRepo] = useState(source?.repo ?? '');
  const [ref, setRef] = useState(source?.ref ?? 'main');
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState(false);
  useUnsavedGuard(Object.values(texts).some(Boolean), undefined, '/dashboard/apps/new');
  const record = query.data;
  const pending = record?.services.filter((s) => unfinished(s.status)) ?? [];
  const changed = record?.services.some((s) => s.status === 'changed');
  const current =
    record?.services.find((s) => s.name === active) ??
    record?.services.find((s) => s.status === 'live');
  const serviceConnections = Object.entries(current?.service_connections ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([envKey, service]) => {
      const target = record?.services.find((s) => s.name === service);
      return {
        env_key: envKey,
        service,
        deployment_id: target?.status === 'live' ? (target.deployment_id ?? '') : '',
      };
    });
  const connectionsReady = serviceConnections.every((c) => !!c.deployment_id);
  async function resume() {
    if (
      !record ||
      busy ||
      changed ||
      record.status === 'applying' ||
      !isValidGitHubRepo(repo) ||
      !isValidGitRef(ref)
    )
      return;
    setBusy(true);
    setError('');
    try {
      const values: Record<string, Record<string, string>> = {};
      for (const s of pending) {
        const env = migrationEnvironment(texts[s.name] ?? '', [], {
          ...s.service_connections,
          ...s.public_build_urls,
        });
        if (env.errors.length) throw new Error(`${s.name}: ${env.errors.join(' ')}`);
        if (env.keys.length) values[s.name] = env.values;
      }
      const plan = await scanMigrationProject(
        { repo: repo.trim(), ref: ref.trim(), projectSlug: record.project },
        pending.map((s) => s.name),
        undefined,
        Object.fromEntries(pending.map((s) => [s.name, s.app || s.name]))
      );
      if (!plan.can_apply)
        throw new Error(
          plan.can_apply_reasons?.join(' ') || 'Resolve the deployment blockers before resuming.'
        );
      setTexts({});
      const result = await resumeProjectMigration(id, {
        expected_version: record.version,
        only: pending.map((s) => s.name),
        plan_token: plan.plan_token,
        ...(Object.keys(values).length ? { initial_secrets: values } : {}),
      });
      setTexts({});
      setReview(false);
      qc.setQueryData(['project-migration', account?.id, id], result);
      void qc.invalidateQueries({ queryKey: ['apps'] });
      void qc.invalidateQueries({ queryKey: ['deployments'] });
    } catch (err) {
      setError(errorMessage(err));
      void query.refetch();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <Panel
        title={record ? `Migration for ${record.project}` : 'Saved project migration'}
        description="Progress is saved on Gregale. You can close this page and resume from your project."
      >
        <p className="break-all font-mono text-xs">Migration {id}</p>
        {!record && (
          <p role="status" className="mt-3 text-sm">
            {query.isError
              ? 'The saved receipt is unavailable. Check progress again before starting another deployment.'
              : 'Waiting for the saved receipt…'}
          </p>
        )}
        {query.isError && (
          <p role="alert" className="mt-3 text-sm text-status-serious">
            {errorMessage(query.error)}
            {query.error instanceof ApiError && query.error.status === 404
              ? ' The original request may still be in progress.'
              : ''}
          </p>
        )}
        {query.error instanceof ApiError && query.error.status === 404 && source && (
          <Link
            to="/dashboard/apps/new"
            search={{
              source: 'import',
              repo: source.repo,
              branch: source.ref,
              slug: source.projectSlug,
            }}
            className="mt-3 inline-block text-sm text-brand"
          >
            Review the original source again
          </Link>
        )}
        {submissionError && !record && (
          <p role="alert" className="mt-3 text-sm text-status-serious">
            {submissionError}
          </p>
        )}
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          Check saved progress
        </Button>
        {record && (
          <>
            <p className="mt-3 text-sm">
              {record.status === 'applying'
                ? 'Applying selected services…'
                : record.status === 'attention'
                  ? 'Some services need attention.'
                  : 'Deployments accepted. Verify each service before cutover.'}
            </p>
            {record.reason && <p className="mt-2 text-sm text-muted-foreground">{record.reason}</p>}
            <p className="mt-2 break-all text-xs text-muted-foreground">
              Reviewed source: {record.source_sha256}
            </p>
            {record.project_id && (
              <Link
                to="/dashboard/projects/$projectSlug"
                params={{ projectSlug: record.project }}
                className="mt-3 inline-block text-sm text-brand"
              >
                Open project
              </Link>
            )}
            <ul className="mt-4 flex flex-col gap-3">
              {record.services.map((s) => (
                <li key={s.name} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{s.name}</strong>
                    <span>
                      {s.status} · attempt {s.attempt}
                    </span>
                  </div>
                  {s.app && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Gregale app: <span className="font-mono">{s.app}</span>
                    </p>
                  )}
                  {s.deployment_id && (
                    <p className="mt-1 break-all font-mono text-xs">Deployment {s.deployment_id}</p>
                  )}
                  {!!s.configured_keys.length && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Configuration keys: {s.configured_keys.join(', ')}
                    </p>
                  )}
                  {!!s.depends_on.length && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Dependencies: {s.depends_on.join(', ')}
                    </p>
                  )}
                  {Object.entries(s.service_connections ?? {}).map(([key, target]) => (
                    <p key={key} className="mt-1 text-xs text-muted-foreground">
                      {key} → {target} on Gregale (saved runtime connection)
                    </p>
                  ))}
                  {Object.entries(s.public_build_urls ?? {}).map(([key, url]) => (
                    <p key={key} className="mt-1 break-all text-xs text-muted-foreground">
                      {key} → {url} (saved public build URL
                      {s.public_service_connections?.[key]
                        ? ` for ${s.public_service_connections[key]}`
                        : ''}
                      )
                    </p>
                  ))}
                  {!!s.build_dependencies?.length && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      APIs required during build: {s.build_dependencies.join(', ')}.
                    </p>
                  )}
                  {s.build_wait && s.status !== 'cancelled' && (
                    <p
                      role={s.build_wait.status === 'failed' ? 'alert' : 'status'}
                      className="mt-1 text-xs text-muted-foreground"
                    >
                      {s.build_wait.detail ||
                        (s.build_wait.status === 'ready'
                          ? 'Build APIs were ready when the build started.'
                          : 'Waiting for APIs before building.')}
                      {s.status === 'waiting' &&
                        ` Wait deadline: ${new Date(s.build_wait.deadline_at).toLocaleString()}. You can close this page.`}
                    </p>
                  )}
                  {s.reason && <p className="mt-1 text-xs text-muted-foreground">{s.reason}</p>}
                  {s.verification_id && (
                    <p className="mt-1 text-xs">
                      Last recorded verification: {s.verification_status}. Reopen checks to review
                      current evidence.
                    </p>
                  )}
                  {s.cutover_id && (
                    <p className="mt-1 text-xs">Saved production cutover: {s.cutover_status}.</p>
                  )}
                  <div className="mt-2 flex gap-3">
                    {s.app && s.app_id && (
                      <Link
                        to="/dashboard/apps/$appSlug"
                        params={{ appSlug: s.app }}
                        className="text-brand"
                      >
                        Open {s.name}
                      </Link>
                    )}
                    {s.status === 'waiting' && s.app && s.app_id && (
                      <span className="text-xs text-muted-foreground">
                        Cancel this waiting deployment from its app.
                      </span>
                    )}
                    {s.status === 'live' && (
                      <Button variant="outline" onClick={() => setActive(s.name)}>
                        Verify and cut over {s.name}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {changed && (
              <p role="alert" className="mt-4 text-sm">
                A service or deployment changed outside this migration. Review its app before
                planning another migration.
              </p>
            )}
            {!!pending.length && !changed && record.status !== 'applying' && (
              <Button className="mt-4" variant="outline" onClick={() => setReview((v) => !v)}>
                Review unfinished services
              </Button>
            )}
          </>
        )}
      </Panel>
      {review && record && pending.length > 0 && (
        <Panel
          title="Resume unfinished services"
          description={`Only ${pending.map((s) => s.name).join(', ')} will be retried. Accepted deployments keep running. Re-scan the original repository revision; Gregale checks its saved checksum.`}
        >
          <fieldset disabled={busy} className="flex flex-col gap-4">
            <legend className="sr-only">Resume configuration</legend>
            <label className="flex flex-col gap-1.5">
              <span className="label-mono">Original repository</span>
              <input
                className={FIELD}
                value={repo}
                placeholder="team/project"
                onChange={(e) => setRepo(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label-mono">Original branch, tag, or commit</span>
              <input className={FIELD} value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
            {pending.map((s) => (
              <label key={s.name} className="flex flex-col gap-1.5">
                <span className="label-mono">Correct configuration for {s.name} (if needed)</span>
                <Textarea
                  value={texts[s.name] ?? ''}
                  rows={4}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setTexts((old) => ({ ...old, [s.name]: e.target.value }))}
                />
                <span className="text-xs text-muted-foreground">
                  Previously sealed values are reused. Re-enter any original keys that were not
                  saved before the failed attempt. Repository requirements:{' '}
                  {s.required_env_keys.join(', ') || 'none declared'}.
                  {Object.keys(s.service_connections ?? {}).length > 0 &&
                    ' Saved service connections are applied automatically; their pasted values are not submitted.'}
                </span>
              </label>
            ))}
            {error && (
              <p role="alert" className="text-sm text-status-serious">
                {error}
              </p>
            )}
            <Button
              onClick={() => void resume()}
              disabled={
                busy ||
                changed ||
                record.status === 'applying' ||
                !isValidGitHubRepo(repo) ||
                !isValidGitRef(ref)
              }
              busy={busy}
            >
              Resume unfinished services
            </Button>
          </fieldset>
        </Panel>
      )}
      {current?.status === 'live' && !connectionsReady && (
        <p role="status" className="text-sm">
          Wait for the connected services to have live deployments before verifying {current.name}.
        </p>
      )}
      {current?.status === 'live' && current.app && current.deployment_id && connectionsReady && (
        <MigrationVerification
          key={current.deployment_id}
          app={current.app}
          deployment={current.deployment_id}
          serviceConnections={serviceConnections}
        />
      )}
    </div>
  );
}

export function SavedProjectMigrations({
  accountId,
  project,
}: {
  accountId: string;
  project: string;
}) {
  const [selected, setSelected] = useState('');
  const query = useQuery({
    queryKey: ['project-migrations', accountId, project],
    queryFn: ({ signal }) => listProjectMigrations(project, signal),
    enabled: !!accountId,
    retry: false,
  });
  const rows = query.data?.migrations ?? [];
  if (!rows.length && !query.isError) return null;
  return (
    <>
      <Panel
        title="Saved migrations"
        description="Resume deployment, verification and cutover progress for this project."
      >
        {query.isError ? (
          <p role="alert">
            Saved migrations could not load.{' '}
            <button className="text-brand" onClick={() => void query.refetch()}>
              Try again
            </button>
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id}>
                <Button variant="outline" onClick={() => setSelected(r.id)}>
                  {r.services.map((s) => s.name).join(', ')} · {r.status}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {selected && <ProjectMigrationProgress key={selected} id={selected} />}
    </>
  );
}
