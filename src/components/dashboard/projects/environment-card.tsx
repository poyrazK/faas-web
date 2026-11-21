import { ArrowUpRight, Flask, ShieldCheck } from 'iconoir-react';
import { useEnvironmentState, type ProjectEnvironment } from '@/lib/api/projects';
import { publicAppUrl } from '@/lib/app-url';
import { absoluteTime, relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { DetailDisclosure } from '../detail-disclosure';
import { ErrorState } from '../primitives';
import { EnvironmentTechnical } from './environment-state';
import { environmentName, environmentSummary, releaseWords } from './environment-words';

/**
 * One environment as a card of its own, so production and staging never read
 * as one list: production has a solid edge and its Protected badge, every other
 * environment a dashed one. Each app is one line — a dot, its name, its short
 * release — and the ids behind it are one "Technical details" away.
 */
export function EnvironmentCard({
  accountId,
  project,
  environment,
  selected,
  onSelect,
}: {
  accountId: string;
  project: string;
  environment: ProjectEnvironment;
  selected: boolean;
  onSelect: () => void;
}) {
  const state = useEnvironmentState(accountId, project, environment.slug);
  const production = environment.slug === 'production';
  const name = environmentName(environment.slug);
  const nameId = `environment-${environment.id}`;
  // Only a state that names this project and environment is shown.
  const data =
    state.data?.project_slug === project && state.data?.environment === environment.slug
      ? state.data
      : undefined;
  const checked = data ? Date.parse(data.generated_at) : NaN;
  const Icon = production || environment.protected ? ShieldCheck : Flask;

  return (
    <section
      aria-labelledby={nameId}
      className={cn(
        'relative flex flex-col gap-4 rounded-[1.25rem] bg-card p-5 transition-shadow',
        production ? 'border-2 border-status-good/45' : 'border border-dashed border-border',
        selected && 'outline-2 outline-offset-2 outline-brand/60'
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h3 id={nameId} className="flex min-w-0 items-center gap-2 text-lg font-semibold">
          <Icon
            aria-hidden
            className={cn(
              'h-4 w-4 shrink-0',
              production ? 'text-status-good' : 'text-muted-foreground'
            )}
          />
          {/* The name selects the environment; the card's own detail stays
              clickable, so only the heading is the control. */}
          <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className="text-left break-words outline-none hover:underline hover:decoration-muted-foreground/50 hover:underline-offset-4 focus-visible:underline"
          >
            {name}
          </button>
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {selected && (
            <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs text-brand">
              Showing below
            </span>
          )}
          {environment.protected && (
            <span className="rounded-full bg-status-good/15 px-2 py-0.5 text-xs text-status-good">
              Protected
            </span>
          )}
        </div>
      </header>

      {state.error ? (
        <ErrorState error={state.error} onRetry={() => void state.refetch()} />
      ) : state.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading {name}…
        </p>
      ) : !data ? (
        <p role="alert" className="text-sm text-destructive">
          {name}&apos;s details do not match this project.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground">{environmentSummary(data)}</span>
            {!Number.isNaN(checked) && (
              <>
                {' · checked '}
                <time dateTime={data.generated_at} title={absoluteTime(checked)}>
                  {relativeTime(checked)}
                </time>
              </>
            )}
          </p>
          {data.workloads.length > 0 && (
            <ul aria-label={`Apps in ${name}`} className="flex flex-col">
              {data.workloads.map((workload) => {
                const live = workload.release.status === 'live';
                const url = publicAppUrl(workload.release.url);
                return (
                  <li
                    key={workload.workload_slug}
                    className="flex items-center justify-between gap-3 border-t border-border/60 py-2.5 text-sm first:border-t-0 first:pt-0"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          live ? 'bg-status-good' : 'bg-muted-foreground/40'
                        )}
                      />
                      <span className="truncate">{workload.workload_name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      <span className={cn(live && 'font-mono text-xs')}>
                        {releaseWords(workload.release)}
                      </span>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${workload.workload_name} in ${name}`}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <DetailDisclosure title="Technical details" summary="ids, variables, secrets">
            <EnvironmentTechnical data={data} />
          </DetailDisclosure>
        </>
      )}
    </section>
  );
}
