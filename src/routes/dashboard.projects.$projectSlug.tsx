import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'iconoir-react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/store';
import { useProject } from '@/lib/api/projects';
import { canonicalApprovalId } from '@/lib/api/environment-readiness';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/dashboard/primitives';
import { TabNav, tabClassName } from '@/components/dashboard/tabs';
import {
  ProjectApps,
  ProjectEnvironmentCards,
} from '@/components/dashboard/projects/project-overview';
import { projectSummary } from '@/components/dashboard/projects/project-words';
import { ProjectStatus } from '@/components/dashboard/projects/project-status';
import { isPaidPlan } from '@/lib/plan';
import { ProjectEnvironments } from '@/components/dashboard/projects/environment-selector';
import {
  validApprovalId,
  type ReadinessSearch,
} from '@/components/dashboard/projects/environment-readiness';
import { ProjectPreviews } from '@/components/dashboard/projects/preview-workload-set';
import { ProjectSourceSettings } from '@/components/dashboard/projects/project-source-settings';
import { ProjectDangerZone } from '@/components/dashboard/projects/project-danger-zone';
import { Route as ProjectsRoute } from './dashboard.projects';

/**
 * The project page is four pages of one project, chosen in the URL:
 * what it runs (Overview), each environment's releases and configuration,
 * pull-request previews, and its settings. A link from before the tabs
 * existed carries only the selection it was about, so the tab is read from
 * that: an environment or a promotion means Environments, a preview means
 * PR previews.
 */
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'environments', label: 'Environments' },
  { key: 'previews', label: 'PR previews' },
  { key: 'settings', label: 'Settings' },
] as const;
type ProjectTab = (typeof TABS)[number]['key'];
const isTab = (value: unknown): value is ProjectTab => TABS.some((tab) => tab.key === value);

export const Route = createFileRoute('/dashboard/projects/$projectSlug')({
  component: ProjectPage,
  validateSearch: (
    search: Record<string, unknown>
  ): ReadinessSearch & {
    tab?: ProjectTab;
    environment?: string;
    compare?: string;
    preview?: string;
    queueWorkload?: string;
  } => {
    const selection = (value: unknown) =>
      value === undefined ? undefined : typeof value === 'string' ? value : '__invalid__';
    return {
      tab: isTab(search.tab) && search.tab !== 'overview' ? search.tab : undefined,
      environment: selection(search.environment),
      compare: selection(search.compare),
      preview: selection(search.preview),
      queueWorkload: selection(search.queueWorkload),
      promotion:
        typeof search.promotion === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(search.promotion)
          ? search.promotion
          : undefined,
      approval:
        typeof search.approval === 'string' && validApprovalId(search.approval)
          ? canonicalApprovalId(search.approval)
          : undefined,
      promotionBefore:
        typeof search.promotionBefore === 'string' && search.promotionBefore.length <= 4096
          ? search.promotionBefore
          : undefined,
      promotionStatus: ['running', 'succeeded', 'failed'].includes(search.promotionStatus as string)
        ? (search.promotionStatus as ReadinessSearch['promotionStatus'])
        : undefined,
    };
  },
});
function ProjectPage() {
  const { projectSlug } = Route.useParams();
  const { account } = useAuth();
  const query = useProject(account?.id ?? '', projectSlug);
  const { workflows, deployments } = useData();
  const { q } = ProjectsRoute.useSearch();
  const search = Route.useSearch();
  const { environment, compare, preview, queueWorkload } = search;
  const navigate = Route.useNavigate();
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!account || query.isPending) return <LoadingState message="Loading project…" />;
  const project = query.data;
  if (!project || project.slug !== projectSlug)
    return (
      <ErrorState
        error={new Error('The project response does not match this selection.')}
        onRetry={() => void query.refetch()}
      />
    );
  const tab: ProjectTab =
    search.tab ??
    (environment || compare || search.promotion || search.approval
      ? 'environments'
      : preview
        ? 'previews'
        : 'overview');
  const apps = new Map(workflows.map((app) => [app.id, app]));
  const summary = projectSummary({ project, apps, deployments: deployments ?? [] });
  const repo = project.repo_full_name;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <Link
          to="/dashboard/projects"
          search={{ q }}
          className="w-fit text-sm text-muted-foreground hover:text-foreground"
        >
          All projects
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">
              {project.slug}
            </h1>
            {/* The answer: what this is, where it deploys from, and whether
                anything needs a look. Built only from what the API returned. */}
            <p className="max-w-2xl text-[15px] text-muted-foreground">
              <span className="text-foreground">{summary.what}</span> {summary.source}{' '}
              {summary.problems.length > 0 ? (
                <>
                  {/* Red for what failed, amber for what is only under way. */}
                  {summary.problems.map((problem, index) => (
                    <span
                      key={problem.text}
                      className={
                        problem.tone === 'critical' ? 'text-status-critical' : 'text-status-warning'
                      }
                    >
                      {index > 0 && '; '}
                      {problem.text}
                    </span>
                  ))}
                  <span className="text-status-warning">
                    {summary.extra > 0 && `; ${summary.extra} more`}.
                  </span>
                </>
              ) : (
                summary.good && <span className="text-brand">{summary.good}</span>
              )}
            </p>
          </div>
          {repo ? (
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <a href={`https://github.com/${repo}`} target="_blank" rel="noopener noreferrer">
                Open {repo}
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : (
            tab !== 'settings' && (
              <Button asChild size="sm">
                <Link
                  to="/dashboard/projects/$projectSlug"
                  params={{ projectSlug }}
                  search={(current) => ({ ...current, tab: 'settings' as const })}
                >
                  Connect a repository
                </Link>
              </Button>
            )
          )}
        </div>
        <TabNav label="Project sections">
          {TABS.map((item) => (
            <Link
              key={item.key}
              to="/dashboard/projects/$projectSlug"
              params={{ projectSlug }}
              // Overview is the project's front page: going back to it drops
              // the selections the other tabs keep in the URL.
              search={
                item.key === 'overview' ? { q } : (current) => ({ ...current, tab: item.key })
              }
              resetScroll={false}
              aria-current={tab === item.key ? 'page' : undefined}
              className={tabClassName(tab === item.key)}
            >
              {item.label}
            </Link>
          ))}
        </TabNav>
      </header>

      {tab === 'overview' && (
        <div className="flex flex-col gap-6">
          <ProjectStatus
            projectSlug={projectSlug}
            workloads={project.workloads}
            apps={apps}
            paid={isPaidPlan(account.plan)}
            planKnown
          />
          <ProjectApps project={project} apps={apps} deployments={deployments ?? []} />
          <ProjectEnvironmentCards
            accountId={account.id}
            projectId={project.id}
            slug={projectSlug}
          />
        </div>
      )}

      {tab === 'environments' && (
        <div className="flex flex-col gap-6">
          <ProjectEnvironments
            accountId={account.id}
            plan={account.plan}
            projectId={project.id}
            slug={projectSlug}
            environment={environment}
            compare={compare}
            queueWorkload={queueWorkload}
            readinessSearch={search}
            onReadinessSearch={(patch) =>
              void navigate({ search: (current) => ({ ...current, ...patch }), resetScroll: false })
            }
            onChange={(next) =>
              void navigate({
                search: (current) => ({
                  ...current,
                  ...next,
                  queueWorkload:
                    current.environment === next.environment ? current.queueWorkload : undefined,
                  promotion: undefined,
                  approval: undefined,
                  promotionBefore: undefined,
                  promotionStatus: undefined,
                }),
                resetScroll: false,
              })
            }
            onSelectQueueWorkload={(slug) =>
              void navigate({
                search: (current) => ({ ...current, queueWorkload: slug }),
                resetScroll: false,
              })
            }
          />
        </div>
      )}

      {tab === 'previews' && (
        <ProjectPreviews
          key={`previews:${account.id}:${project.id}`}
          accountId={account.id}
          projectId={project.id}
          projectSlug={projectSlug}
          parents={project.workloads.map((workload) => workload.slug)}
          selected={preview}
          defaultOpen
          onSelect={(slug) =>
            void navigate({
              search: (current) => ({ ...current, preview: slug }),
              resetScroll: false,
            })
          }
        />
      )}

      {tab === 'settings' && (
        <div className="flex flex-col gap-6">
          <ProjectSourceSettings
            key={`settings:${account.id}:${project.id}:${project.updated_at}`}
            accountId={account.id}
            project={project}
          />
          <ProjectDangerZone
            key={`danger:${account.id}:${project.id}`}
            accountId={account.id}
            project={project}
            onDeleted={() => void navigate({ to: '/dashboard/projects', search: { q } })}
          />
        </div>
      )}
    </div>
  );
}
