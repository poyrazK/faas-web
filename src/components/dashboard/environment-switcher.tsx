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
import { Button } from '@/components/ui/button';
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
  className,
}: {
  kind: EnvironmentKind;
  label: string;
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
      <span className="truncate">{label}</span>
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
      <span aria-hidden className="shrink-0 text-muted-foreground/40">
        /
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Environment: ${env.name}. Switch environment`}
          className="pressable flex min-w-0 items-center gap-1 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-brand"
        >
          <Pill kind={unavailable ? 'stage' : env.kind} label={label} className="min-w-0" />
          <NavArrowDown aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="label-mono text-muted-foreground">
            Environments
          </DropdownMenuLabel>
          {env.list.isError ? (
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
              <span className="text-muted-foreground">Environments could not be read</span>
              <Button size="xs" variant="outline" onClick={env.list.refetch}>
                Retry
              </Button>
            </div>
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
                      search: (current: Record<string, unknown>) => ({
                        ...current,
                        env: choice.slug === 'production' ? undefined : choice.slug,
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
