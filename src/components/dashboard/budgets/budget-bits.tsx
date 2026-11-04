import { useMemo, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  Archive,
  Bell,
  CheckCircle,
  Code,
  EditPencil,
  Lock,
  Pause,
  WarningTriangle,
} from 'iconoir-react';
import { api, unwrap } from '@/lib/api/client';
import { projectKeys, useProjects } from '@/lib/api/projects';
import { retryPolicy, useApps, useJobs } from '@/lib/api/queries';
import { LEVELS, budgetLevel, type Budget, type BudgetSpec, type ScopeKind } from '@/lib/budgets';
import { formatMillicents } from '@/lib/money';

type Tone = { label: string; color: string; icon: typeof CheckCircle };

/** A small status in colour, icon and word, never colour alone. */
export function ToneLabel({ tone, children }: { tone: Tone; children?: ReactNode }) {
  const Icon = tone.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap"
      style={{ color: tone.color }}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {children ?? tone.label}
    </span>
  );
}

const MUTED = 'var(--muted-foreground)';
const GOOD = 'var(--status-good)';
const WARN = 'var(--status-warning)';
const BAD = 'var(--status-critical)';

/**
 * What a budget is doing now. A hold or an automatic stop outranks "Active",
 * because it is the thing a person opening the page needs to see first.
 */
export function budgetTone(budget: Budget): Tone {
  if (budget.status === 'deleted') return { label: 'Deleted', color: MUTED, icon: Archive };
  if (budget.status === 'draft') return { label: 'Draft · off', color: MUTED, icon: EditPencil };
  if (budget.status === 'unavailable')
    return { label: 'Unavailable', color: WARN, icon: WarningTriangle };
  if (budget.runtime?.compute?.held) return { label: 'Held at limit', color: BAD, icon: Lock };
  if (budget.runtime?.stops?.length) return { label: 'Stopping previews', color: BAD, icon: Pause };
  return { label: 'Active', color: GOOD, icon: CheckCircle };
}

export function BudgetStatus({ budget }: { budget: Budget }) {
  return <ToneLabel tone={budgetTone(budget)} />;
}

const LEVEL_ICON = { alert: Bell, 'stop-previews': Pause, strict: Lock } as const;

export function LevelLabel({ spec }: { spec: BudgetSpec }) {
  const level = budgetLevel(spec);
  if (level === 'api')
    return (
      <ToneLabel tone={{ label: 'Set through the API', color: MUTED, icon: Code }}>
        <span className="font-mono">{spec.action.replace(/_/g, ' ')}</span>
      </ToneLabel>
    );
  return (
    <ToneLabel
      tone={{ label: LEVELS[level].label, color: 'var(--foreground)', icon: LEVEL_ICON[level] }}
    />
  );
}

/**
 * Known spending against the limit, as one scalar bar. The projected month
 * end, when apid has one, is a marker on the same bar and a sentence below
 * it: a scalar estimate, never drawn as a series (there is none).
 */
export function SpendMeter({
  known,
  limit,
  projected,
  label,
}: {
  known: number | undefined;
  limit: number;
  projected?: number;
  label: string;
}) {
  if (known === undefined)
    return (
      <p className="text-sm text-muted-foreground">
        Spending could not be evaluated, so it is unknown; it is never read as $0.
      </p>
    );
  const pct = limit > 0 ? Math.min(100, (known / limit) * 100) : 100;
  const color = pct >= 100 ? BAD : pct >= 80 ? WARN : GOOD;
  const mark =
    projected !== undefined && limit > 0 ? Math.min(100, (projected / limit) * 100) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm [font-variant-numeric:tabular-nums]">
        <span className="font-medium">{formatMillicents(known)}</span>
        <span className="text-muted-foreground"> of {formatMillicents(limit)}</span>
      </p>
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        {mark !== null && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-foreground/70"
            style={{ left: `calc(${mark}% - 1px)` }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Names for the ids a budget scope carries. Only the lists a budget actually
 * needs are read; an id nothing resolves is shown, never replaced by a guess.
 */
export function useScopeLabel(accountId: string, specs: BudgetSpec[] | undefined) {
  const kinds = useMemo(
    () => new Set<ScopeKind>((specs ?? []).map((spec) => spec.scope.kind)),
    [specs]
  );
  const apps = useApps({ enabled: kinds.has('app'), retry: retryPolicy });
  const jobs = useJobs(undefined, kinds.has('job'));
  const needProjects = kinds.has('project') || kinds.has('environment');
  const projects = useProjects(needProjects ? accountId : '');
  const envs = useQueries({
    queries: (kinds.has('environment') ? (projects.data ?? []) : []).map((project) => ({
      queryKey: [...projectKeys.detail(accountId, project.slug), 'environments'],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        unwrap(
          api.GET('/v1/projects/{slug}/environments', {
            params: { path: { slug: project.slug } },
            signal,
          })
        ),
      retry: retryPolicy,
      staleTime: 30_000,
    })),
  });
  const envNames = new Map<string, string>();
  envs.forEach((query, index) => {
    const project = projects.data?.[index];
    for (const env of query.data ?? []) envNames.set(env.id, `${project?.slug}/${env.slug}`);
  });
  return (scope: BudgetSpec['scope']): string => {
    const id = scope.id ?? '';
    switch (scope.kind) {
      case 'account':
        return 'the whole account';
      case 'app':
        return apps.data?.find((app) => app.id === id)?.slug ?? `app ${id.slice(0, 8)}`;
      case 'job':
        return jobs.data?.jobs.find((job) => job.id === id)?.name ?? `job ${id.slice(0, 8)}`;
      case 'project':
        return (
          projects.data?.find((project) => project.id === id)?.slug ?? `project ${id.slice(0, 8)}`
        );
      case 'environment':
        return envNames.get(id) ?? `environment ${id.slice(0, 8)}`;
    }
  };
}

export type ScopeLabel = ReturnType<typeof useScopeLabel>;

/** A labelled fact in a definition list, as the alert detail lays them out. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="label-mono text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}
