import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FIELD, Textarea } from '@/components/ui/field';
import {
  createProjectMigration,
  scanMigrationProject,
  type MigrationPlan,
  type MigrationSource,
} from '@/lib/api/project-migration';
import { errorMessage } from '@/lib/api/errors';
import { migrationEnvironment } from '@/lib/migration-environment';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { Panel } from './primitives';
import { RepoPicker } from './repo-picker';
import { ProjectMigrationProgress } from './project-migration-progress';
import { MigrationServiceConnections } from './migration-service-connections';
import { MigrationPublicConnections } from './migration-public-connections';
import { MigrationBuildDependencies } from './migration-build-dependencies';
import { publicBuildURLKeyError, publicBuildURLError } from '@/lib/migration-public-urls';
import { isValidGitHubRepo, isValidGitRef, type DeploymentRecoveryContext } from './new-app-source';

type Workload = NonNullable<MigrationPlan['workloads']>[number];
const eligible = (w: Workload) => (w.class === 'http' || w.class === 'graphql') && !w.image;
export function ProjectMigration({
  initialRepo = '',
  initialRef = 'main',
  initialSlug = '',
  onMigrationChange,
  onBusyChange,
}: {
  initialRepo?: string;
  initialRef?: string;
  initialSlug?: string;
  onRecoveryChange?: (recovery: DeploymentRecoveryContext) => void;
  onMigrationChange?: (id: string, source: MigrationSource) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const uid = useId();
  const qc = useQueryClient();
  const [repo, setRepo] = useState(initialRepo);
  const [ref, setRef] = useState(initialRef);
  const [slug, setSlug] = useState(initialSlug);
  const [source, setSource] = useState<MigrationSource>();
  const [catalog, setCatalog] = useState<MigrationPlan>();
  const [selection, setSelection] = useState<string[]>([]);
  const [plan, setPlan] = useState<MigrationPlan>();
  const [appSlugs, setAppSlugs] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [connections, setConnections] = useState<Record<string, Record<string, string>>>({});
  const [publicConnections, setPublicConnections] = useState<
    Record<string, Record<string, string>>
  >({});
  const [publicURLs, setPublicURLs] = useState<Record<string, Record<string, string>>>({});
  const [buildDependencies, setBuildDependencies] = useState<Record<string, string[]>>({});
  const [publicApproved, setPublicApproved] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [migration, setMigration] = useState('');
  const identity = useRef('');
  const operation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(
    () => () => {
      controller.current?.abort();
      operation.current++;
    },
    []
  );
  useUnsavedGuard(
    (Object.values(texts).some(Boolean) ||
      Object.values(buildDependencies).some((targets) => targets.length > 0) ||
      [connections, publicConnections, publicURLs].some((entries) =>
        Object.values(entries).some((c) => Object.keys(c).length > 0)
      )) &&
      !migration,
    undefined,
    '/dashboard/apps/new'
  );
  const projectSlug =
    slug.trim() ||
    repo
      .trim()
      .split('/')[1]
      ?.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-') ||
    '';
  const validSource =
    isValidGitHubRepo(repo) && isValidGitRef(ref) && /^[a-z0-9][a-z0-9-]{0,62}$/.test(projectSlug);
  const selected = (plan?.workloads ?? []).filter((w) => selection.includes(w.name));
  const environments = Object.fromEntries(
    selected.map((w) => [
      w.name,
      migrationEnvironment(texts[w.name] ?? '', w.required_env_keys ?? [], {
        ...connections[w.name],
        ...publicConnections[w.name],
        ...publicURLs[w.name],
      }),
    ])
  );
  const invalid = selected.some((w) => environments[w.name].errors.length > 0);
  const invalidBuildDependencies = selected.some((w) =>
    (buildDependencies[w.name] ?? []).some(
      (name) => !w.depends_on?.includes(name) || !selected.some((target) => target.name === name)
    )
  );
  const invalidConnections = selected.some((w) =>
    Object.values(connections[w.name] ?? {}).some(
      (target) =>
        !w.depends_on?.includes(target) || !selected.some((service) => service.name === target)
    )
  );
  const namesReviewed = selected.every((w) => appSlugs[w.name] === (w.app_slug ?? w.name));
  const invalidPublic = selected.some((w) => {
    const mappings = publicConnections[w.name] ?? {};
    const urls = publicURLs[w.name] ?? {};
    const keys = [...Object.keys(mappings), ...Object.keys(urls)];
    return (
      keys.length > 10 ||
      (keys.length > 0 && !publicApproved[w.name]) ||
      keys.some((key) => !!publicBuildURLKeyError(key)) ||
      Object.values(urls).some((url) => !!publicBuildURLError(url)) ||
      Object.values(mappings).some((name) => {
        const target = selected.find((s) => s.name === name);
        return (
          !w.depends_on?.includes(name) ||
          !target?.public_url ||
          !!publicBuildURLError(target.public_url)
        );
      })
    );
  });
  function reset() {
    controller.current?.abort();
    operation.current++;
    identity.current = '';
    setBusy(false);
    setCatalog(undefined);
    setPlan(undefined);
    setSelection([]);
    setAppSlugs({});
    setTexts({});
    setConnections({});
    setBuildDependencies({});
    setPublicConnections({});
    setPublicURLs({});
    setPublicApproved({});
    setError('');
  }
  async function scan(only: string[] = [], names?: Record<string, string>) {
    if (submitting.current || busy || !validSource) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const current = ++operation.current;
    const input = { repo: repo.trim(), ref: ref.trim(), projectSlug };
    setBusy(true);
    setError('');
    try {
      const result = names
        ? await scanMigrationProject(input, only, abort.signal, names)
        : await scanMigrationProject(input, only, abort.signal);
      if (current !== operation.current) return;
      setSource(input);
      identity.current = '';
      if (only.length) {
        setPlan(result);
        setPublicApproved({});
        setAppSlugs(
          Object.fromEntries((result.workloads ?? []).map((w) => [w.name, w.app_slug ?? w.name]))
        );
      } else {
        setCatalog(result);
        setPlan(undefined);
        const candidates = (result.workloads ?? []).filter(eligible);
        setSelection(candidates.length === 1 ? [candidates[0].name] : []);
      }
    } catch (err) {
      if (current === operation.current && !abort.signal.aborted) setError(errorMessage(err));
    } finally {
      if (current === operation.current) setBusy(false);
    }
  }
  async function deploy() {
    if (
      submitting.current ||
      !source ||
      !plan?.can_apply ||
      !selected.length ||
      invalid ||
      invalidConnections ||
      invalidPublic ||
      invalidBuildDependencies ||
      !namesReviewed
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError('');
    identity.current ||= crypto.randomUUID();
    const id = identity.current;
    // Persist only this pointer in navigation before sending any secret values.
    onMigrationChange?.(id, source);
    const initialSecrets = Object.fromEntries(
      selected
        .filter((w) => environments[w.name].keys.length)
        .map((w) => [w.name, environments[w.name].values])
    );
    setTexts({});
    setMigration(id);
    try {
      await createProjectMigration({
        id,
        plan_token: plan.plan_token,
        only: selected.map((w) => w.name),
        ...(Object.keys(initialSecrets).length ? { initial_secrets: initialSecrets } : {}),
        ...(Object.values(connections).some((c) => Object.keys(c).length > 0)
          ? { service_connections: connections }
          : {}),
        ...(Object.values(publicConnections).some((c) => Object.keys(c).length > 0)
          ? { public_service_connections: publicConnections }
          : {}),
        ...(Object.values(buildDependencies).some((targets) => targets.length > 0)
          ? {
              build_dependencies: Object.fromEntries(
                selected
                  .filter((w) => buildDependencies[w.name]?.length)
                  .map((w) => [w.name, buildDependencies[w.name]])
              ),
            }
          : {}),
        ...(Object.values(publicURLs).some((c) => Object.keys(c).length > 0)
          ? { public_build_urls: publicURLs }
          : {}),
      });
      void qc.invalidateQueries({ queryKey: ['apps'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['project-migration'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (migration)
    return <ProjectMigrationProgress id={migration} source={source} submissionError={error} />;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Move HTTP and GraphQL services together. Keep existing databases and storage, verify each
        deployment, then switch production traffic service by service.
      </p>
      <Panel
        title="1. Connect your source"
        description="Use a repository your connected GitHub installation can access."
      >
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Repository source</legend>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono">Repository</span>
            <RepoPicker
              value={repo}
              onChange={(value, branch) => {
                reset();
                setRepo(value);
                if (branch) setRef(branch);
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono">Branch, tag, or commit</span>
            <input
              className={FIELD}
              value={ref}
              onChange={(e) => {
                reset();
                setRef(e.target.value);
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono">Project name</span>
            <input
              className={FIELD}
              value={slug}
              placeholder={projectSlug || 'my-project'}
              onChange={(e) => {
                reset();
                setSlug(e.target.value);
              }}
            />
          </label>
          <div className="flex items-end">
            <Button
              onClick={() => void scan()}
              disabled={!validSource || busy}
              busy={busy && !catalog}
            >
              Scan repository
            </Button>
          </div>
        </fieldset>
      </Panel>
      {error && (
        <p role="alert" className="text-sm text-status-serious">
          {error}
        </p>
      )}
      {catalog && !plan && (
        <Panel
          title="2. Choose services"
          description="Select up to ten source-backed HTTP or GraphQL services. Worker and scheduled workloads stay with your current provider. Automatic GitHub deployments stay off during migration."
        >
          <fieldset disabled={busy} className="flex flex-col gap-3">
            <legend className="sr-only">Services to migrate</legend>
            {(catalog.workloads ?? []).map((w) => (
              <label
                key={w.name}
                className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"
              >
                <input
                  type="checkbox"
                  name={`${uid}-service`}
                  checked={selection.includes(w.name)}
                  disabled={!eligible(w) || (!selection.includes(w.name) && selection.length >= 10)}
                  onChange={(e) => {
                    setSelection((old) =>
                      e.target.checked ? [...old, w.name] : old.filter((n) => n !== w.name)
                    );
                    setTexts({});
                  }}
                />
                <span>
                  <span className="font-mono">{w.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    {w.class ?? 'unknown'} · {w.root_dir || '/'}
                  </span>
                  {!eligible(w) && (
                    <span className="block text-xs text-muted-foreground">
                      Keep this workload on your current provider for this migration.
                    </span>
                  )}
                  {!!w.depends_on?.length && (
                    <span className="block text-xs text-muted-foreground">
                      Depends on: {w.depends_on.join(', ')}
                    </span>
                  )}
                </span>
              </label>
            ))}
            {!catalog.workloads?.some(eligible) && (
              <p>
                No source-backed HTTP service was detected. Review this repository’s workload
                configuration before continuing.
              </p>
            )}
            <Button
              onClick={() => void scan(selection)}
              disabled={!selection.length || busy}
              busy={busy}
            >
              Configure selected services
            </Button>
          </fieldset>
        </Panel>
      )}
      {plan && selected.length > 0 && (
        <>
          <Panel
            title="3. Choose app names"
            description="Keep the service names in your repository. Choose the Gregale app names used for their URLs."
          >
            <fieldset disabled={busy} className="flex flex-col gap-4">
              <legend className="sr-only">Gregale app names</legend>
              {selected.map((w) => (
                <label key={w.name} className="flex flex-col gap-1.5">
                  <span className="label-mono">Gregale app name for {w.name}</span>
                  <input
                    aria-label={`Gregale app name for ${w.name}`}
                    className={FIELD}
                    value={appSlugs[w.name] ?? ''}
                    disabled={w.action === 'update'}
                    maxLength={40}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setAppSlugs((old) => ({ ...old, [w.name]: e.target.value }))}
                  />
                  <span className="text-xs text-muted-foreground">
                    {w.action === 'update'
                      ? 'This service keeps its existing Gregale app name.'
                      : 'Use 3–40 lowercase letters, digits or hyphens. Names must be available across Gregale.'}
                  </span>
                </label>
              ))}
              {!namesReviewed && (
                <p role="status" className="text-sm">
                  Check the edited app names before deploying.
                </p>
              )}
              <Button
                variant="outline"
                disabled={busy || selected.some((w) => !appSlugs[w.name])}
                busy={busy}
                onClick={() => void scan(selection, appSlugs)}
              >
                Check app names
              </Button>
              {namesReviewed && plan.can_apply && (
                <p role="status" className="text-sm">
                  App names are available for this migration. Availability is checked again when
                  deploying.
                </p>
              )}
            </fieldset>
          </Panel>
          <Panel
            title="4. Review dependencies"
            description="Confirm connections between selected services and services staying with your current provider."
          >
            <ul className="list-inside list-disc text-sm">
              {selected.map((w) => (
                <li key={w.name}>
                  {w.name}:{' '}
                  {(w.depends_on ?? []).length
                    ? w.depends_on
                        ?.map(
                          (n) =>
                            `${n} (${selection.includes(n) ? 'selected' : 'keep existing connection'})`
                        )
                        .join(', ')
                    : 'No declared service dependencies'}
                </li>
              ))}
              {plan.managed?.map((m) => (
                <li key={m.name}>
                  {m.name} ({m.kind}): keep existing connection
                  {m.env_hint ? ` in ${m.env_hint}` : ''}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Map runtime variables to selected dependencies below. Other connections keep their
              supplied values. Saved mappings are reused on retry and verified against the selected
              target deployments before cutover.
            </p>
            {invalidConnections && (
              <p role="alert" className="mt-3 text-sm text-status-serious">
                The reviewed dependencies changed. Review service connections before deploying.
              </p>
            )}
          </Panel>
          {invalidBuildDependencies && (
            <p role="alert">Review APIs needed during builds; a selected dependency changed.</p>
          )}
          {selected.map((w) => {
            const env = environments[w.name];
            return (
              <Panel
                key={w.name}
                title={`Configure ${w.name}`}
                description="Runtime values are sealed and reviewed public URLs are saved before builds are queued."
              >
                <p className="mb-3 text-sm text-muted-foreground">
                  Start command: <code>{w.command?.join(' ') || 'Detected during build'}</code>
                </p>
                {!!w.env_keys?.length && (
                  <p className="mb-3 text-xs text-muted-foreground">
                    Detected variable names: {w.env_keys.join(', ')}. Detection alone does not make
                    a variable required.
                  </p>
                )}
                {!!w.required_env_keys?.length && (
                  <p className="mb-3 text-xs">
                    Required by your repository: {w.required_env_keys.join(', ')}.
                  </p>
                )}
                <MigrationServiceConnections
                  caller={w.name}
                  keys={[
                    ...(w.env_keys ?? []),
                    ...(w.required_env_keys ?? []),
                    ...migrationEnvironment(texts[w.name] ?? '').keys,
                  ]}
                  targets={(w.depends_on ?? []).filter((name) =>
                    selected.some((target) => target.name === name)
                  )}
                  connections={connections[w.name] ?? {}}
                  disabled={busy}
                  onChange={(value) => setConnections((old) => ({ ...old, [w.name]: value }))}
                />
                <MigrationPublicConnections
                  caller={w.name}
                  origin={w.public_url}
                  keys={[
                    ...(w.env_keys ?? []),
                    ...(w.required_env_keys ?? []),
                    ...migrationEnvironment(texts[w.name] ?? '').keys,
                  ]}
                  imported={migrationEnvironment(texts[w.name] ?? '').values}
                  targets={selected
                    .filter((t) => w.depends_on?.includes(t.name))
                    .map((t) => ({ name: t.name, url: t.public_url }))}
                  connections={publicConnections[w.name] ?? {}}
                  urls={publicURLs[w.name] ?? {}}
                  approved={publicApproved[w.name] ?? false}
                  disabled={busy}
                  onApprove={(value) => setPublicApproved((old) => ({ ...old, [w.name]: value }))}
                  onChange={(mappings, urls) => {
                    setPublicConnections((old) => ({ ...old, [w.name]: mappings }));
                    setPublicURLs((old) => ({ ...old, [w.name]: urls }));
                    setPublicApproved((old) => ({ ...old, [w.name]: false }));
                  }}
                />
                <MigrationBuildDependencies
                  caller={w.name}
                  targets={(w.depends_on ?? []).filter((name) =>
                    selected.some((target) => target.name === name)
                  )}
                  selected={buildDependencies[w.name] ?? []}
                  disabled={busy}
                  onChange={(value) => setBuildDependencies((old) => ({ ...old, [w.name]: value }))}
                />
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono">Environment variables for {w.name}</span>
                  <Textarea
                    rows={6}
                    value={texts[w.name] ?? ''}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                    placeholder="DATABASE_URL=your-existing-connection-string"
                    onChange={(e) => setTexts((old) => ({ ...old, [w.name]: e.target.value }))}
                  />
                </label>
                <label className="mt-3 inline-flex cursor-pointer text-sm text-brand">
                  Import a .env file for {w.name}
                  <input
                    type="file"
                    accept=".env,text/plain"
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 1_048_576) {
                        setError('Choose a .env file smaller than 1 MiB.');
                        return;
                      }
                      const current = operation.current;
                      void file
                        .text()
                        .then((value) => {
                          if (current === operation.current && !submitting.current)
                            setTexts((old) => ({ ...old, [w.name]: value }));
                        })
                        .catch(() =>
                          setError('Could not read that file. Paste its contents instead.')
                        );
                    }}
                  />
                </label>
                {!!env.keys.length && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Ready to configure: {env.keys.join(', ')}. Values stay in this form until
                    submitted.
                  </p>
                )}
                {!!env.errors.length && (
                  <ul
                    aria-label={`Environment errors for ${w.name}`}
                    className="mt-3 list-inside list-disc text-sm text-status-serious"
                  >
                    {env.errors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                )}
                {w.action === 'update' && (
                  <p className="mt-3 text-sm">
                    This updates the existing Gregale app {w.app_slug ?? w.name} and supplied
                    configuration keys.
                  </p>
                )}
              </Panel>
            );
          })}
          <Panel
            title="5. Deploy and verify"
            description="Save one migration for every selected service, deployment, verification and cutover. Your production domain and traffic stay with your existing provider."
          >
            {!!plan.warnings?.length && (
              <ul className="mb-3 list-inside list-disc text-sm text-muted-foreground">
                {plan.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {!plan.can_apply && (
              <p role="alert" className="mb-3 text-sm text-status-serious">
                {plan.can_apply_reasons?.join(' ') ||
                  'These services cannot be deployed under the current plan.'}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPlan(undefined);
                  setTexts({});
                  setConnections({});
                  setBuildDependencies({});
                  setPublicConnections({});
                  setPublicURLs({});
                  setPublicApproved({});
                }}
              >
                Back to services
              </Button>
              <Button
                disabled={
                  busy ||
                  !plan.can_apply ||
                  invalid ||
                  invalidConnections ||
                  invalidPublic ||
                  invalidBuildDependencies ||
                  !namesReviewed
                }
                busy={busy}
                onClick={() => void deploy()}
              >
                Deploy selected services
              </Button>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
