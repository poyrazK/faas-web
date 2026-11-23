import { Link, useNavigate } from '@tanstack/react-router';
import { Check, Flask, GitFork, GitCompare, NavArrowDown, ShieldCheck } from 'iconoir-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useEnvironmentState, type ProjectEnvironment } from '@/lib/api/projects';
import { useAuth } from '@/lib/auth';
import {
  environmentKind,
  environmentName,
  useEnvironmentScope,
  type EnvironmentKind,
} from '@/lib/environment-scope';
import { useProjectScope } from '@/lib/project-scope';
import { cn } from '@/lib/utils';

const ICON = { production: ShieldCheck, stage: Flask, preview: GitFork } as const;

/** Production green, stages amber, previews neutral: status tokens, both themes. */
const TINT: Record<EnvironmentKind, string> = {
  production: 'bg-status-good/12 text-status-good ring-status-good/30',
  stage: 'bg-status-warning/12 text-status-warning ring-status-warning/30',
  preview: 'bg-muted text-muted-foreground ring-border',
};

function Pill({
  kind,
  label,
  compact = false,
  className,
}: {
  kind: EnvironmentKind;
  label: string;
  /** On a phone the top bar is full: show the tinted icon, keep the name for sm and up. */
  compact?: boolean;
  className?: string;
}) {
  const Icon = ICON[kind];
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] ring-1',
        TINT[kind],
        className
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className={cn('truncate', compact && 'hidden sm:inline')}>{label}</span>
    </span>
  );
}

/** "Protected · 3 live", "2 live", "Nothing deployed", or nothing while it loads. */
function EnvironmentStatus({
  project,
  environment,
}: {
  project: string;
  environment: ProjectEnvironment;
}) {
  const { account } = useAuth();
  const state = useEnvironmentState(account?.id ?? '', project, environment.slug);
  if (!state.data || state.data.environment !== environment.slug) return null;
  const live = state.data.workloads.filter((w) => w.release.status === 'live').length;
  const words = live ? `${live} live` : 'Nothing deployed';
  return (
    <span className="text-xs text-muted-foreground">
      {environment.protected ? `Protected · ${live ? words : words.toLowerCase()}` : words}
    </span>
  );
}

/**
 * The top bar's environment, after the project: a tinted pill that always says
 * where you are, and a menu of the project's environments. Production is the
 * absence of `?env=`, so choosing it clears the param.
 */
export function EnvironmentSwitcher() {
  const env = useEnvironmentScope();
  const { project } = useProjectScope();
  const navigate = useNavigate();
  if (!env.applies || !project) return null;
  const unavailable = env.available === false;
  const label = unavailable ? `${env.name} · not in this project` : env.name;

  return (
    <>
      <span aria-hidden className="hidden shrink-0 text-muted-foreground/40 @lg/topbar:inline">
        /
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Environment: ${env.name}. Switch environment`}
          className="pressable flex shrink-0 items-center gap-1 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-brand"
        >
          {/* Never squeezed away: on a phone the other crumbs give way first. */}
          <Pill kind={unavailable ? 'stage' : env.kind} label={label} compact />
          <NavArrowDown aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="label-mono text-muted-foreground">
            Environments
          </DropdownMenuLabel>
          {env.list.isError ? (
            <>
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                Environments could not be read
              </p>
              {/* A menu item, not a button: arrow keys and Enter reach it. */}
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  env.list.refetch();
                }}
              >
                Retry
              </DropdownMenuItem>
            </>
          ) : !env.choices ? (
            <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">
              Loading environments…
            </p>
          ) : (
            env.choices.map((choice) => {
              const selected = choice.slug === env.environment;
              return (
                <DropdownMenuItem
                  key={choice.id}
                  className="justify-between gap-3"
                  onSelect={() => {
                    if (selected) return;
                    void navigate({
                      to: '.',
                      // A comparison, promotion or approval belongs to the
                      // environment it was chosen in; it doesn't follow.
                      search: (current: Record<string, unknown>) => ({
                        ...current,
                        env: choice.slug === 'production' ? undefined : choice.slug,
                        compare: undefined,
                        promotion: undefined,
                        approval: undefined,
                        promotionBefore: undefined,
                        promotionStatus: undefined,
                        queueWorkload: undefined,
                      }),
                    } as never);
                  }}
                >
                  <Pill
                    kind={environmentKind(choice.slug, choice)}
                    label={environmentName(choice.slug)}
                  />
                  <span className="flex items-center gap-2">
                    <EnvironmentStatus project={project} environment={choice} />
                    <Check aria-hidden className={cn('h-3.5 w-3.5', !selected && 'invisible')} />
                    {selected && <span className="sr-only">(current)</span>}
                  </span>
                </DropdownMenuItem>
              );
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              to="/dashboard/projects/$projectSlug"
              params={{ projectSlug: project }}
              search={{ tab: 'environments' } as never}
            >
              <GitCompare aria-hidden className="h-3.5 w-3.5" />
              Compare environments
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * A 2px line across the very top of the console whenever you are not in
 * production: amber in a stage, quiet in a preview, so nobody edits staging
 * thinking it is production (or the reverse). The pill carries the meaning for
 * assistive tech; the line is decoration.
 */
export function EnvironmentLine() {
  const env = useEnvironmentScope();
  if (!env.applies || env.kind === 'production') return null;
  return (
    <div
      aria-hidden
      data-testid="environment-line"
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5',
        env.kind === 'stage' ? 'bg-status-warning' : 'bg-muted-foreground/60'
      )}
    />
  );
}
