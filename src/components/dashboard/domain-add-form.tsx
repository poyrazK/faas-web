import { useId, useState, type ReactNode, type RefObject } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FieldError, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useAuth, type Plan } from '@/lib/auth';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import type { CapabilityAccess } from '@/lib/capability-state';
import { ApiError } from '@/lib/api/errors';
import { useProjectEnvironments, useProjectMembership, validEnvironment } from '@/lib/api/projects';
import { useAddDomain, useApps } from '@/lib/api/queries';
import { cn } from '@/lib/utils';
import { InlinePhase, queryPhase } from './primitives';
import { ProblemHelp } from './problem-help';
import { SegmentedControl } from './tabs';

/** A registrable hostname: labels of letters/digits/hyphens, at least one dot. */
export const HOST_RULE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** A custom domain as the API names it: a hostname, or `*.` and a zone of two labels or more. */
export const isDomainName = (value: string) => HOST_RULE.test(value.replace(/^\*\./, ''));

/**
 * Plans whose limits allow a wildcard custom domain (faas pkg/api/limits.go
 * WildcardDomainsAllowed; createDomain refuses the rest with 402
 * `wildcard_domains_not_allowed`).
 */
const WILDCARD_PLANS: readonly Plan[] = ['pro', 'scale'];

export type WildcardGate = 'allowed' | 'checking' | 'plan' | 'unreleased';

/**
 * Whether this account may add a wildcard, in the handler's order: the
 * `wildcard-domains` capability first (a hidden one is refused with
 * `capability_not_released`), then the plan. The plan is the signed-in
 * account's, which is whose apps this form binds to.
 */
export function wildcardGate(plan: Plan | undefined, access: CapabilityAccess): WildcardGate {
  if (access === 'off') return 'unreleased';
  if (!plan) return 'checking';
  return WILDCARD_PLANS.includes(plan) ? 'allowed' : 'plan';
}

const planName = (plan: Plan) => plan.charAt(0).toUpperCase() + plan.slice(1);

/** `default` and `pr-preview` are scopes, not registered environments: createDomain refuses both. */
const bindable = (slug: string) => validEnvironment(slug) && slug !== 'pr-preview';

type Kind = 'host' | 'wildcard';
const KINDS = [
  { key: 'host', label: 'Single host' },
  { key: 'wildcard', label: 'Wildcard' },
] as const;

const FIELD_CLASS =
  'h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Bind a custom domain (`POST /v1/domains`, faas handlers_ext.go createDomain).
 *
 * Two optional shapes beyond a single hostname. A wildcard (`*.example.com`)
 * covers every name below its zone and is Pro and Scale only; the form says so
 * before anyone types one. An environment binds the domain to one named
 * environment of the app's project, so traffic follows only that
 * environment's release set; only an app in a project has environments, and
 * membership comes from the project details, never a guess.
 */
export function DomainAddForm({ hostRef }: { hostRef?: RefObject<HTMLInputElement | null> }) {
  const { toast } = useToast();
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const appQuery = useApps();
  const apps = appQuery.data;
  const addDomain = useAddDomain();
  const membership = useProjectMembership(accountId);
  const gate = wildcardGate(account?.plan, useCapabilityAccess('wildcard-domains').access);
  const ids = { host: useId(), hostError: useId(), app: useId(), environment: useId() };

  const [kind, setKind] = useState<Kind>('host');
  const [host, setHost] = useState('');
  const [appSlug, setAppSlug] = useState('');
  // The environment is chosen for one app; picking another app drops it.
  const [picked, setPicked] = useState({ app: '', environment: '' });
  const [refusal, setRefusal] = useState<{ error: ApiError; message: ReactNode } | null>(null);
  const validation = useFormValidation<'host'>();

  const target = (apps ?? []).find((a) => a.slug === (appSlug || apps?.[0]?.slug));
  const project = target ? membership.projectOfApp.get(target.slug) : undefined;
  const environments = useProjectEnvironments(accountId, project ?? '');
  const choices = (environments.data ?? []).map((e) => e.slug).filter(bindable);
  const environment =
    target && picked.app === target.slug && choices.includes(picked.environment)
      ? picked.environment
      : '';

  const wildcard = kind === 'wildcard';
  const blocked = wildcard && gate !== 'allowed';
  const typed = host.trim().toLowerCase();
  const zone = typed.replace(/^\*\./, '');
  const domain = wildcard ? `*.${zone}` : typed;
  const hostError = wildcard
    ? HOST_RULE.test(zone)
      ? undefined
      : 'Enter the zone the wildcard covers, like example.com.'
    : typed.startsWith('*.')
      ? `To add ${typed}, choose Wildcard above.`
      : HOST_RULE.test(typed)
        ? undefined
        : 'Enter a full hostname, like api.example.com.';
  const showHostError = validation.submitAttempted ? hostError : undefined;

  // What the environment select can offer for the chosen app, without ever
  // reading a disabled query's pending flag as loading.
  const environmentState: 'pending' | 'error' | 'none' | 'ready' =
    membership.state === 'pending'
      ? 'pending'
      : membership.state === 'error'
        ? 'error'
        : !project
          ? 'none'
          : environments.error
            ? 'error'
            : environments.isPending
              ? 'pending'
              : 'ready';
  const environmentError =
    membership.state === 'error'
      ? (membership.list.error ?? membership.details.find((d) => d.error)?.error)
      : environments.error;

  const explain = (err: ApiError): ReactNode => {
    if (err.code === 'wildcard_domains_not_allowed') return <PlanLimit />;
    if (err.code === 'capability_not_released' && wildcard) return UNRELEASED;
    if (err.code === 'not_found' && environment && project && target)
      return `${environment} is no longer an environment of ${project}, or ${target.slug} has left the project. Its environments were read again.`;
    return null;
  };

  const submit = () => {
    // The create endpoint binds by app id, while everything the user sees is a
    // slug — so the selection is resolved back to an id here.
    if (!target) {
      toast({ kind: 'error', title: 'Pick an app to route the domain to' });
      return;
    }
    setRefusal(null);
    void addDomain
      .mutateAsync({
        domain,
        app_id: target.id,
        ...(environment ? { environment } : {}),
      })
      .then((created) => {
        setHost('');
        validation.resetValidation();
        toast({
          kind: 'success',
          title: 'Domain added',
          description: created.txt_record
            ? 'Publish the TXT record shown in the table to verify it.'
            : undefined,
        });
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? explain(err) : null;
        if (err instanceof ApiError && message) {
          setRefusal({ error: err, message });
          if (err.code === 'not_found') void environments.refetch();
          return;
        }
        toast({ kind: 'error', title: 'Could not add domain', error: err });
      });
  };

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        label="Domain kind"
        value={kind}
        options={KINDS}
        onChange={(next) => {
          setKind(next);
          setRefusal(null);
          validation.resetValidation();
        }}
      />

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (blocked) return;
          if (!validation.validate({ host: hostError }, e.currentTarget) || addDomain.isPending)
            return;
          submit();
        }}
      >
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor={ids.host} className="label-mono text-muted-foreground">
            Hostname
          </label>
          <div
            className={cn(
              'flex h-10 items-center rounded-lg border bg-background focus-within:border-brand',
              showHostError ? 'border-[color:var(--status-critical)]' : 'border-border',
              blocked && 'opacity-50'
            )}
          >
            {wildcard && (
              <span
                aria-hidden
                className="select-none pl-3 font-mono text-sm text-muted-foreground"
              >
                *.
              </span>
            )}
            <input
              id={ids.host}
              ref={hostRef}
              name="host"
              value={host}
              disabled={blocked}
              onChange={(e) => {
                setHost(e.target.value);
                setRefusal(null);
              }}
              {...fieldErrorProps(showHostError, ids.hostError)}
              placeholder={wildcard ? 'example.com' : 'api.example.com'}
              autoCapitalize="none"
              spellCheck={false}
              className={cn(
                'h-full min-w-0 flex-1 rounded-lg bg-transparent text-sm outline-none disabled:cursor-not-allowed',
                wildcard ? 'pl-0.5 pr-3' : 'px-3'
              )}
            />
          </div>
          {showHostError && <FieldError id={ids.hostError}>{showHostError}</FieldError>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.app} className="label-mono text-muted-foreground">
            Routes to
          </label>
          <select
            id={ids.app}
            value={target?.slug ?? ''}
            onChange={(e) => {
              setAppSlug(e.target.value);
              setRefusal(null);
            }}
            className={FIELD_CLASS}
          >
            {(apps ?? []).map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.slug}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.environment} className="label-mono text-muted-foreground">
            Environment
          </label>
          <select
            id={ids.environment}
            value={environmentState === 'ready' ? environment : ''}
            disabled={environmentState !== 'ready'}
            onChange={(e) => {
              setPicked({ app: target?.slug ?? '', environment: e.target.value });
              setRefusal(null);
            }}
            className={FIELD_CLASS}
          >
            {environmentState === 'ready' ? (
              <>
                <option value="">App-wide</option>
                {choices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </>
            ) : (
              <option value="">
                {environmentState === 'pending'
                  ? 'Loading…'
                  : environmentState === 'none'
                    ? 'Not in a project'
                    : 'Unavailable'}
              </option>
            )}
          </select>
        </div>

        <Button
          type="submit"
          size="sm"
          className="gap-1.5"
          busy={addDomain.isPending}
          disabled={!apps?.length || Boolean(appQuery.error) || blocked}
        >
          <Plus className="h-3.5 w-3.5" />
          Add domain
        </Button>
      </form>

      {wildcard && <WildcardNote gate={gate} plan={account?.plan} />}
      {environment && project && (
        <p className="text-xs text-muted-foreground">
          Traffic follows only {environment}’s active release set in {project}. An environment-bound
          domain cannot be the app’s default.
        </p>
      )}

      {appQuery.error && (
        <InlinePhase
          phase={queryPhase({ error: appQuery.error })}
          error={appQuery.error}
          onRetry={() => void appQuery.refetch()}
        />
      )}
      {environmentState === 'error' && Boolean(environmentError) && (
        <InlinePhase
          phase={queryPhase({ error: environmentError })}
          error={environmentError}
          onRetry={
            membership.state === 'error' ? membership.retry : () => void environments.refetch()
          }
        />
      )}
      {refusal && (
        <div role="alert" className="flex items-start gap-2 text-sm">
          <WarningTriangle
            aria-hidden
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            style={{ color: 'var(--status-critical)' }}
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span>{refusal.message}</span>
            <ProblemHelp error={refusal.error} />
          </span>
        </div>
      )}
    </div>
  );
}

const UNRELEASED =
  'Wildcard domains are not available to this account. Contact support for access.';

function PlanLimit({ plan }: { plan?: Plan }) {
  return (
    <>
      Wildcard domains are included in Pro and Scale
      {plan ? `; this account is on the ${planName(plan)} plan. ` : '. '}
      <Link to="/dashboard/plans" className="text-brand underline-offset-4 hover:underline">
        Compare plans
      </Link>
    </>
  );
}

/** What a wildcard covers, or why this account cannot add one. */
function WildcardNote({ gate, plan }: { gate: WildcardGate; plan?: Plan }) {
  return (
    <p className="text-xs text-muted-foreground">
      {gate === 'allowed' ? (
        'Covers every name below the zone, such as eu.example.com, but not example.com itself. Each new name gets its own certificate on its first HTTPS connection, at most 40 in any 7 days; the domain’s details can limit which names may.'
      ) : gate === 'plan' ? (
        <PlanLimit plan={plan} />
      ) : gate === 'unreleased' ? (
        UNRELEASED
      ) : (
        'Checking this account’s plan…'
      )}
    </p>
  );
}
