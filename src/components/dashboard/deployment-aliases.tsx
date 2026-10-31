import { useState, type FormEvent } from 'react';
import { Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { FIELD } from '@/components/ui/field';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useAppDeployments, type Deployment } from '@/lib/api/queries';
import {
  aliasNameProblem,
  aliasServing,
  aliasTargetable,
  useDeleteDeploymentAlias,
  useDeploymentAliases,
  useSetDeploymentAlias,
  type DeploymentAlias,
} from '@/lib/api/deployment-aliases';
import { formatRelative } from '@/lib/mock-data';
import { cn } from '@/lib/utils';
import { CapabilityGate } from './capability-gate';
import { InlinePhase, Panel, queryPhase } from './primitives';

const CAPABILITY = 'deployment-aliases';

const revisionLabel = (revision?: number, id?: string) =>
  revision ? `v${revision}` : id ? id.slice(0, 8) : 'this release';

/** The catalog's maturity, so the label follows the registry when it graduates. */
function MaturityTag({ maturity }: { maturity?: string }) {
  const label = maturity === 'beta' ? 'Beta' : maturity === 'preview' ? 'Preview' : '';
  if (!label) return null;
  return (
    <span className="label-mono rounded-full border border-border px-2 py-0.5 text-muted-foreground">
      {label}
    </span>
  );
}

const where = (alias: DeploymentAlias) => alias.url ?? alias.host ?? `The ${alias.name} alias`;

type Outcome = { done: true } | { done: false; problem?: string };

/**
 * Point and remove, with the confirmations both surfaces share. Moving an
 * existing name changes what its URL serves for everyone using it, so it asks
 * first and names both releases; creating a new name changes nothing anyone
 * relies on yet, so it does not.
 */
function useAliasActions(slug: string, aliases: DeploymentAlias[]) {
  const set = useSetDeploymentAlias(slug);
  const remove = useDeleteDeploymentAlias(slug);
  const confirm = useConfirm();
  const { toast } = useToast();

  const point = async (
    name: string,
    target: { id: string; revision?: number }
  ): Promise<Outcome> => {
    const problem = aliasNameProblem(name);
    if (problem) return { done: false, problem };
    const to = revisionLabel(target.revision, target.id);
    const current = aliases.find((alias) => alias.name === name);
    if (current?.deployment_id === target.id)
      return { done: false, problem: `${name} already points at ${to}.` };
    if (current) {
      const from = revisionLabel(current.revision, current.deployment_id);
      const ok = await confirm({
        title: `Move ${name} from ${from} to ${to}?`,
        description: `${where(current)} will serve ${to} instead of ${from}, for everyone using it, as soon as you confirm. Production traffic does not change.`,
        confirmLabel: 'Move alias',
      });
      if (!ok) return { done: false };
    }
    try {
      const saved = await set.mutateAsync({ name, deploymentId: target.id });
      toast({
        kind: 'success',
        title: `${saved.name} now points at ${revisionLabel(saved.revision, saved.deployment_id)}`,
        description: saved.url ?? 'This installation has no public apps domain, so it has no URL.',
      });
      return { done: true };
    } catch (error) {
      // apid's detail already says why: a target that is not live or in
      // progress, a name too long for the host label, a hostname collision.
      return { done: false, problem: errorMessage(error) };
    }
  };

  const drop = async (alias: DeploymentAlias) => {
    const ok = await confirm({
      title: `Remove alias ${alias.name}?`,
      description: `${where(alias)} stops serving ${revisionLabel(alias.revision, alias.deployment_id)}. The release itself and production traffic are unchanged, and setting ${alias.name} again brings the same URL back.`,
      confirmLabel: 'Remove alias',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(alias.name);
      toast({ kind: 'success', title: `Removed ${alias.name}` });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found')
        toast({ kind: 'info', title: `${alias.name} was already removed` });
      else
        toast({
          kind: 'error',
          title: `Could not remove ${alias.name}`,
          description: errorMessage(error),
        });
    }
  };

  return { point, drop, busy: set.isPending || remove.isPending };
}

function AliasUrl({ alias }: { alias: DeploymentAlias }) {
  if (!alias.url && !alias.host)
    return (
      <span className="text-xs text-muted-foreground">No public URL on this installation</span>
    );
  const href = alias.url ?? `https://${alias.host}`;
  const host = alias.host ?? href.replace(/^https:\/\//, '');
  return (
    <span className="flex min-w-0 items-center gap-1">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 truncate font-mono text-xs text-brand underline-offset-4 hover:underline"
        title={href}
      >
        {host}
      </a>
      <CopyIconButton text={href} label={`URL of alias ${alias.name}`} />
    </span>
  );
}

function servingText(alias: DeploymentAlias) {
  const target = revisionLabel(alias.revision, alias.deployment_id);
  switch (aliasServing(alias)) {
    case 'serving':
      return `Serving ${target}`;
    case 'waiting':
      return `Serves ${target} once it is live`;
    case 'stopped':
      return `Not serving: ${target} is ${alias.deployment_status}`;
    default:
      return `Points at ${target}`;
  }
}

function Problem({ text }: { text: string }) {
  return (
    <span role="alert" className="text-xs text-[color:var(--status-critical)]">
      {text}
    </span>
  );
}

/** The app's aliases on its Deployments tab: list, point, move and remove. */
export function DeploymentAliasesPanel(props: {
  slug: string;
  onOpenDeployment: (id: string) => void;
}) {
  return (
    <CapabilityGate capability={CAPABILITY} title="Deployment aliases">
      <AliasesBody {...props} />
    </CapabilityGate>
  );
}

function AliasesBody({
  slug,
  onOpenDeployment,
}: {
  slug: string;
  onOpenDeployment: (id: string) => void;
}) {
  const { capability } = useCapabilityAccess(CAPABILITY);
  const query = useDeploymentAliases(slug);
  const deploymentsQuery = useAppDeployments(slug);
  const aliases = query.data ?? [];
  const { point, drop, busy } = useAliasActions(slug, aliases);
  const targets = (deploymentsQuery.data?.pages.flatMap((page) => page.items) ?? []).filter((d) =>
    aliasTargetable(d.status)
  );
  const [name, setName] = useState('');
  const [picked, setPicked] = useState('');
  const [problem, setProblem] = useState('');
  const target = targets.find((d) => d.id === picked) ?? targets[0];
  const moving = aliases.some((alias) => alias.name === name.trim());
  const example = targets.find((d) => d.status === 'live') ?? targets[0];
  const command = `gregale release alias set --app ${slug} --name canary --release ${example?.revision ? `v${example.revision}` : 'vN'}`;
  const phase = queryPhase({
    error: query.error,
    loading: query.isPending,
    isEmpty: aliases.length === 0,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!target) return;
    const outcome = await point(name.trim(), target);
    if (outcome.done) setName('');
    setProblem(outcome.done ? '' : (outcome.problem ?? ''));
  };

  return (
    <Panel
      title="Deployment aliases"
      description="Stable URLs that each serve one exact release. Pointing, moving or removing one never changes production traffic."
      actions={<MaturityTag maturity={capability?.maturity} />}
    >
      <div className="flex flex-col gap-4">
        {phase === 'empty' ? (
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>
              No aliases yet. Point one at a release to give it a URL that stays put while newer
              releases ship, for a reviewer, a partner, or a test suite.
            </p>
            <span className="flex min-w-0 items-center gap-1 rounded-md bg-muted/40 px-3 py-1.5">
              <code className="min-w-0 truncate font-mono text-xs">{command}</code>
              <CopyIconButton text={command} label="alias set command" />
            </span>
          </div>
        ) : phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={query.error}
            loadingMessage="Loading aliases…"
            onRetry={() => void query.refetch()}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {aliases.map((alias) => {
              const state = aliasServing(alias);
              return (
                <li
                  key={alias.name}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
                    <span className="truncate font-mono text-sm font-medium">{alias.name}</span>
                    <span
                      className={cn(
                        'text-xs',
                        state === 'stopped'
                          ? 'text-[color:var(--status-warning)]'
                          : 'text-muted-foreground'
                      )}
                    >
                      {servingText(alias)}
                      {' · '}
                      {formatRelative(Date.parse(alias.updated_at))}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-[2] basis-64">
                    <AliasUrl alias={alias} />
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Open release ${revisionLabel(alias.revision, alias.deployment_id)}`}
                      onClick={() => onOpenDeployment(alias.deployment_id)}
                    >
                      Open release
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Remove alias ${alias.name}`}
                      disabled={busy}
                      onClick={() => void drop(alias)}
                    >
                      <Trash className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {query.data && (
          <form
            className="flex flex-col gap-1.5 border-t border-border pt-4"
            onSubmit={(event) => void submit(event)}
          >
            <span className="label-mono text-muted-foreground">Point an alias</span>
            {targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No live or in-progress release to point at. Deploy first.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Alias name"
                  value={name}
                  placeholder="canary"
                  spellCheck={false}
                  autoCapitalize="off"
                  onChange={(event) => {
                    setName(event.target.value);
                    setProblem('');
                  }}
                  className={cn(FIELD, 'w-44 font-mono')}
                />
                <select
                  aria-label="Release"
                  value={target?.id ?? ''}
                  onChange={(event) => {
                    setPicked(event.target.value);
                    setProblem('');
                  }}
                  className={cn(FIELD, 'w-full min-w-0 sm:w-64')}
                >
                  {targets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {releaseOption(d)}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline" busy={busy}>
                  {moving ? 'Move alias' : 'Set alias'}
                </Button>
              </div>
            )}
            {problem && <Problem text={problem} />}
          </form>
        )}
      </div>
    </Panel>
  );
}

const releaseOption = (d: Deployment) =>
  `${revisionLabel(d.revision, d.id)} · ${d.status} · ${formatRelative(Date.parse(d.created_at))}`;

/** In the release drawer: the aliases on this release, and pointing one here. */
export function DeploymentAliasesHere({
  slug,
  deployment,
}: {
  slug: string;
  deployment: Deployment;
}) {
  const { access, capability } = useCapabilityAccess(CAPABILITY);
  // The app's Deployments tab explains an off capability; the drawer stays quiet.
  if (access !== 'on') return null;
  return <HereBody slug={slug} deployment={deployment} maturity={capability?.maturity} />;
}

function HereBody({
  slug,
  deployment,
  maturity,
}: {
  slug: string;
  deployment: Deployment;
  maturity?: string;
}) {
  const query = useDeploymentAliases(slug);
  const aliases = query.data ?? [];
  const { point, busy } = useAliasActions(slug, aliases);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const here = aliases.filter((alias) => alias.deployment_id === deployment.id);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const outcome = await point(name.trim(), deployment);
    if (outcome.done) setName('');
    setProblem(outcome.done ? '' : (outcome.problem ?? ''));
  };

  return (
    <section
      aria-label="Aliases"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex items-center gap-2">
        <h3 className="label-mono text-muted-foreground">Aliases</h3>
        <MaturityTag maturity={maturity} />
      </div>
      {query.data ? (
        here.length ? (
          <ul className="flex flex-col gap-1.5">
            {here.map((alias) => (
              <li key={alias.name} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-sm font-medium">{alias.name}</span>
                <AliasUrl alias={alias} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No alias points at this release.</p>
        )
      ) : (
        <InlinePhase
          phase={queryPhase({ error: query.error, loading: query.isPending })}
          error={query.error}
          loadingMessage="Loading aliases…"
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data &&
        (aliasTargetable(deployment.status) ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => void submit(event)}
          >
            <input
              aria-label="Alias name"
              value={name}
              placeholder="canary"
              spellCheck={false}
              autoCapitalize="off"
              onChange={(event) => {
                setName(event.target.value);
                setProblem('');
              }}
              className={cn(FIELD, 'w-44 font-mono')}
            />
            <Button type="submit" size="sm" variant="outline" busy={busy}>
              Point alias here
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only a live or in-progress release can take an alias. Roll back to this one or redeploy
            it first.
          </p>
        ))}
      {problem && <Problem text={problem} />}
    </section>
  );
}
