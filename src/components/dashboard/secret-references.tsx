import { useId, useRef, useState } from 'react';
import { Plus, Trash } from 'iconoir-react';
import { useAuth } from '@/lib/auth';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useProjectEnvironments, useProjectMembership, validEnvironment } from '@/lib/api/projects';
import {
  useRemoveSecretReference,
  useScopedSecretNames,
  useSecretReferences,
  useSetSecretReference,
} from '@/lib/api/secret-references';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FieldError } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { InlinePhase, Panel, queryPhase } from './primitives';

/** ValidateEnvKey in faas pkg/api/env.go. */
const KEY_RULE = /^[A-Z][A-Z0-9_]*$/;
/** EnvironmentSecretReferenceSuppressionsMaxPerApp in faas pkg/api/limits.go. */
const SUPPRESSIONS_MAX = 1024;
const FIELD =
  'h-10 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-brand';

type Context = { key: string; source?: string; environment: string; quota?: number };

/** Copy per `ApiError.code` from handlers_secret_references.go `writeSecretReferenceProblem`. */
function explain(error: unknown, { key, source, environment, quota }: Context): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'secret_not_found':
        return `There is no secret named ${source ?? key} in ${environment}. Set it in that environment first.`;
      case 'secret_reference_conflict':
        return `${environment} has a plain variable named ${key}, which a reference cannot replace. Remove that variable (or reload, if the environment was just recreated) and try again.`;
      case 'environment_field_git_managed':
        return `This reference is managed by Git. Change it in the environment definition, or create a temporary override with a reason and expiry.`;
      case 'plan_limit_env_vars':
        return `This app has used all ${quota ?? 'its'} variable and reference slots across its environments. Remove one first.`;
      case 'secret_reference_suppression_limit':
        return `This app already keeps ${SUPPRESSIONS_MAX.toLocaleString()} removed keys across its environments. Deliver one of them again before removing more.`;
      case 'not_found':
        return `${environment} is no longer an environment of this project. Reload the page.`;
      case 'capacity_unavailable':
        return 'Secret references are briefly unavailable. Try again in a moment.';
    }
  }
  return errorMessage(error);
}

/**
 * Secret references (faas ADR-568): in one environment of the app's project,
 * deliver one of the app's sealed secrets under another variable name. Only
 * this app's secrets in that same environment can be named; a reference never
 * reaches another app, the project's shared secrets, or an outside store.
 */
export function SecretReferences({ slug }: { slug: string }) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const membership = useProjectMembership(accountId);
  const project = membership.projectOfApp.get(slug);
  const phase =
    membership.state === 'error' ? 'error' : membership.state === 'pending' ? 'loading' : 'ready';
  return (
    <Panel
      title="Secret references"
      description="Deliver one of this app’s sealed secrets under another variable name, in one environment of its project. The source must be this app’s secret in that same environment; a reference cannot reach another app’s or the project’s secrets. Changes apply on the next cold wake: running instances keep what they booted with."
    >
      <div className="flex flex-col gap-4 text-sm">
        <InlinePhase
          phase={phase}
          error={membership.list.error ?? membership.details.find((d) => d.error)?.error}
          loadingMessage="Loading project…"
          onRetry={membership.retry}
        />
        {phase === 'ready' &&
          (project ? (
            <ProjectReferences accountId={accountId} project={project} slug={slug} />
          ) : (
            <p className="text-muted-foreground">
              {slug} is not in a project. References belong to a project environment, so this app
              receives each secret under its own name.
            </p>
          ))}
      </div>
    </Panel>
  );
}

function ProjectReferences({
  accountId,
  project,
  slug,
}: {
  accountId: string;
  project: string;
  slug: string;
}) {
  const environments = useProjectEnvironments(accountId, project);
  // default and pr-preview are scopes, not registered environments: the API refuses both.
  const choices = (environments.data ?? [])
    .map((environment) => environment.slug)
    .filter((name) => validEnvironment(name) && name !== 'pr-preview');
  const [picked, setPicked] = useState('');
  const environment =
    picked && choices.includes(picked)
      ? picked
      : choices.includes('production')
        ? 'production'
        : (choices[0] ?? '');
  const phase = queryPhase({
    error: environments.error,
    loading: environments.isLoading,
    isEmpty: choices.length === 0,
  });
  if (phase !== 'ready')
    return (
      <InlinePhase
        phase={phase}
        error={environments.error}
        loadingMessage="Loading environments…"
        emptyMessage={`${project} has no environments yet.`}
        onRetry={() => void environments.refetch()}
      />
    );
  return (
    <>
      <label className="flex w-fit flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Environment</span>
        <select
          value={environment}
          onChange={(e) => setPicked(e.target.value)}
          className={cn(FIELD, 'min-w-44 font-sans')}
        >
          {choices.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <EnvironmentReferences key={environment} slug={slug} environment={environment} />
    </>
  );
}

function EnvironmentReferences({ slug, environment }: { slug: string; environment: string }) {
  const references = useSecretReferences(slug, environment);
  const sources = useScopedSecretNames(slug, environment);
  const save = useSetSecretReference(slug, environment);
  const remove = useRemoveSecretReference(slug, environment);
  const confirm = useConfirm();
  const { toast } = useToast();
  const keyInput = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [key, setKey] = useState('');
  const [source, setSource] = useState('');
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState('');
  const keyOk = KEY_RULE.test(key.trim());
  const showKeyError = touched && key.trim().length > 0 && !keyOk;

  const data = references.data;
  const entries = Object.entries(data?.references ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const suppressed = data?.suppressed_keys ?? [];
  const names = sources.data ?? [];
  const phase = queryPhase({ error: references.error, loading: references.isLoading });

  async function removeReference(destination: string, reference: string) {
    const from = reference.replace(/^secret:/, '');
    const ok = await confirm({
      title: `Stop delivering ${destination} in ${environment}?`,
      description: `From its next cold wake, the main workload in ${environment} no longer receives ${destination}, not even from a secret of the same name, so code that reads it there finds it unset. The sealed secret ${from} itself is kept, sidecars keep their own grants, and running instances keep the value until they restart. Set a reference again to restore it.`,
      confirmLabel: 'Remove reference',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(destination, {
      onSuccess: () =>
        toast({ kind: 'success', title: `${destination} removed in ${environment}` }),
      onError: (error) =>
        toast({
          kind: 'error',
          title: 'Could not remove the reference',
          description: explain(error, { key: destination, environment }),
        }),
    });
  }

  function deliverAgain(name: string) {
    setKey(name);
    setTouched(false);
    setFailure('');
    if (names.includes(name)) setSource(name);
    keyInput.current?.focus();
  }

  if (phase !== 'ready')
    return (
      <InlinePhase
        phase={phase}
        error={references.error}
        loadingMessage="Loading references…"
        onRetry={() => void references.refetch()}
      />
    );

  return (
    <>
      {entries.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {entries.map(([destination, reference]) => (
            <li key={destination} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
              <span className="font-mono text-xs">{destination}</span>
              <span className="text-xs text-muted-foreground">from</span>
              <span className="font-mono text-xs text-muted-foreground">
                {reference.replace(/^secret:/, '')}
              </span>
              <button
                type="button"
                aria-label={`Remove reference ${destination}`}
                onClick={() => void removeReference(destination, reference)}
                className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
              >
                <Trash className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          No references in {environment}. Each secret reaches the app under its own name.
        </p>
      )}

      {suppressed.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Not delivered in {environment}: these were removed, so the main workload no longer
            receives them, even under their own names. Sidecars keep their own grants.
          </p>
          <ul className="flex flex-wrap gap-2">
            {suppressed.map((name) => (
              <li
                key={name}
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1"
              >
                <span className="font-mono text-xs">{name}</span>
                <button
                  type="button"
                  aria-label={`Deliver ${name} again`}
                  onClick={() => deliverAgain(name)}
                  className="text-xs text-brand underline underline-offset-4"
                >
                  Deliver again
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && (
        <p className="text-xs text-muted-foreground">
          {data.count} of {data.quota} variables and references used across all environments.
        </p>
      )}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!keyOk || !source || save.isPending) return;
          const destination = key.trim();
          setFailure('');
          save.mutate(
            { key: destination, source },
            {
              onSuccess: () => {
                setKey('');
                setSource('');
                setTouched(false);
                toast({
                  kind: 'success',
                  title: `${destination} now comes from ${source} in ${environment}`,
                  description: 'Instances pick it up when they next boot.',
                });
              },
              onError: (error) =>
                setFailure(
                  explain(error, { key: destination, source, environment, quota: data?.quota })
                ),
            }
          );
        }}
      >
        <label className="flex min-w-44 flex-1 flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Variable</span>
          <input
            ref={keyInput}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showKeyError || undefined}
            aria-describedby={showKeyError ? errorId : undefined}
            placeholder="DATABASE_URL"
            className={cn(FIELD, showKeyError && 'border-[color:var(--status-critical)]')}
          />
          {showKeyError && (
            <FieldError id={errorId}>
              UPPER_SNAKE_CASE: a letter first, then letters, digits, or underscores.
            </FieldError>
          )}
        </label>
        <label className="flex min-w-44 flex-1 flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Source secret</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            disabled={names.length === 0}
            className={FIELD}
          >
            <option value="">{sources.isLoading ? 'Loading…' : 'Choose a secret'}</option>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          size="sm"
          className="gap-1.5"
          disabled={!keyOk || !source}
          busy={save.isPending}
        >
          <Plus className="h-3.5 w-3.5" />
          Save reference
        </Button>
      </form>
      {failure && (
        <p role="alert" className="text-xs text-[color:var(--status-critical)]">
          {failure}
        </p>
      )}
      {sources.isSuccess && names.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No secrets are set in {environment} yet. A reference can only name one, so set it there
          first:{' '}
          <code className="font-mono text-foreground">
            gregale env set --app {slug} --env {environment} NAME=value
          </code>
        </p>
      )}
      {sources.error && (
        <p className="text-xs text-muted-foreground">
          Could not list the secrets in {environment}: {errorMessage(sources.error)}
        </p>
      )}
    </>
  );
}
