import { useId, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Lock } from 'iconoir-react';
import type { Deployment, Workflow } from '@/lib/mock-data';
import { useProjectEnvironments, validEnvironment, type ProjectDetail } from '@/lib/api/projects';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useEnvironmentScope } from '@/lib/environment-scope';
import { Button } from '@/components/ui/button';
import { AppTile, AppTiles } from '../app-tile';
import { HelpTip } from '../kit/help-tip';
import { statusWord, workloadNote } from './project-words';

const PAGE = 12;

/** A heading and what it holds, on the faint tray the Projects page uses. */
function Tray({
  title,
  meta,
  help,
  children,
}: {
  title: string;
  meta?: ReactNode;
  help?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-[1.75rem] bg-muted/25 p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-1">
        <h2 id={id} className="flex items-center gap-1 text-lg font-semibold tracking-[-0.01em]">
          {title}
          {help && <HelpTip label={`About ${title.toLowerCase()}`}>{help}</HelpTip>}
        </h2>
        {meta && <p className="text-[13px] text-muted-foreground">{meta}</p>}
      </header>
      {children}
    </section>
  );
}

/**
 * The project's apps as tiles: is each one running, is a deploy failing or
 * under way, and what it calls. Build, deployment and rollout history is the
 * app's own Releases page, one click into the tile.
 */
export function ProjectApps({
  project,
  apps,
  deployments,
}: {
  project: Pick<ProjectDetail, 'slug' | 'workloads' | 'exclusions'>;
  apps: Map<string, Workflow>;
  deployments: Pick<Deployment, 'workflowId' | 'state' | 'createdAt'>[];
}) {
  const [limit, setLimit] = useState(PAGE);
  const { workloads, exclusions } = project;
  return (
    <Tray
      title="Apps"
      meta={workloads.length ? 'Open one for its logs, releases and settings.' : undefined}
      help={
        <>
          The apps come from the repository (Compose or <code>.gregale/project.yaml</code>), and so
          does what each one calls (<code>depends_on</code>). Both change on the next deploy.
        </>
      }
    >
      {!workloads.length ? (
        <p className="px-1 text-sm text-muted-foreground">This project has no apps yet.</p>
      ) : (
        <AppTiles label={`Apps in ${project.slug}`}>
          {workloads.slice(0, limit).map((workload) => (
            <AppTile
              key={workload.slug}
              slug={workload.slug}
              label={workload.workload_name !== workload.slug ? workload.workload_name : undefined}
              app={apps.get(workload.slug)}
              fallbackState={statusWord(workload.status)}
              deploy={workloadNote(workload, deployments)}
              detail={
                workload.depends_on?.length ? `Calls ${workload.depends_on.join(', ')}` : undefined
              }
            />
          ))}
        </AppTiles>
      )}
      {workloads.length > limit && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setLimit(limit + PAGE)}
        >
          Show {Math.min(PAGE, workloads.length - limit)} more apps
        </Button>
      )}
      {exclusions.length > 0 && (
        <p className="px-1 text-[13px] text-muted-foreground">
          Left out of this project: <span className="font-mono">{exclusions.join(', ')}</span>
        </p>
      )}
    </Tray>
  );
}

/**
 * The project's environments, one card each, leading into the Environments
 * tab. A company's environments are not readable yet (see
 * `ProjectEnvironments`), so a company workspace shows no section at all
 * rather than a card that cannot be opened.
 */
export function ProjectEnvironmentCards({
  accountId,
  projectId,
  slug,
}: {
  accountId: string;
  projectId: string;
  slug: string;
}) {
  const { org } = useWorkspaceTarget();
  if (org) return null;
  return <EnvironmentCards accountId={accountId} projectId={projectId} slug={slug} />;
}

function EnvironmentCards({
  accountId,
  projectId,
  slug,
}: {
  accountId: string;
  projectId: string;
  slug: string;
}) {
  const query = useProjectEnvironments(accountId, slug);
  const { environment: current } = useEnvironmentScope();
  const items = (query.data ?? []).filter(
    (item) => item.project_id === projectId && validEnvironment(item.slug)
  );
  return (
    <Tray
      title="Environments"
      help="Each environment runs its own copy of this project's apps, with its own configuration and secrets."
    >
      {query.isError ? (
        <p className="flex flex-wrap items-center gap-3 px-1 text-sm text-muted-foreground">
          The environments could not be read.
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </p>
      ) : query.isPending ? (
        <p role="status" className="px-1 text-sm text-muted-foreground">
          Loading environments…
        </p>
      ) : !items.length ? (
        <p className="px-1 text-sm text-muted-foreground">This project has no environments yet.</p>
      ) : (
        <ul
          aria-label={`Environments of ${slug}`}
          className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3"
        >
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to="/dashboard/projects/$projectSlug"
                params={{ projectSlug: slug }}
                // Opening an environment switches the console into it (the top
                // bar's ?env=); production is the absence of the param.
                search={(search) =>
                  ({
                    ...search,
                    tab: 'environments' as const,
                    env: item.slug === 'production' ? undefined : item.slug,
                    environment: undefined,
                    compare: undefined,
                  }) as never
                }
                aria-label={`Open ${item.slug}`}
                aria-current={item.slug === current ? 'true' : undefined}
                className="surface pressable group flex min-h-16 items-center gap-3 rounded-[1.25rem] bg-card px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-sm">{item.slug}</span>
                    {item.slug === current && (
                      <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] text-brand">
                        Current
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {item.protected ? (
                      <>
                        <Lock aria-hidden className="size-3" />
                        Protected
                      </>
                    ) : (
                      'Not protected'
                    )}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-(--motion-ease) group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Tray>
  );
}
