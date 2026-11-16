import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Check, Folder, NavArrowDown, Upload } from 'iconoir-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { STANDALONE, isAccountPath, useProjectScope } from '@/lib/project-scope';
import { cn } from '@/lib/utils';

/** Where a project's own overview lives; standalone apps have no project page. */
export function projectHome(slug: string): { to: string; search: { project?: string } } {
  return slug === STANDALONE
    ? { to: '/dashboard/apps', search: { project: STANDALONE } }
    : { to: `/dashboard/projects/${encodeURIComponent(slug)}`, search: { project: undefined } };
}

/**
 * Where switching to `next` should land from `pathname`: the same section in
 * the other project (Supabase keeps you on Storage when you switch), except
 * from a page that belongs to one project — its overview or one of its apps —
 * which has no counterpart, so the new project's overview opens instead.
 */
export function switchTarget(
  pathname: string,
  next: string
): { to: string; search: { project?: string } } {
  const projectPage = /^\/dashboard\/(projects\/[^/]+|apps\/(?!new(?:\/|$))[^/]+|apps\/?$)/.test(
    pathname
  );
  return projectPage ? projectHome(next) : { to: pathname, search: { project: next } };
}

/**
 * The breadcrumb's second level inside a project: which project the rail is
 * about, and the way to another one or back out to all of them.
 */
export function ProjectSwitcher() {
  const scope = useProjectScope();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  // At account level there is nothing to switch; a project page opened
  // without a project covers all apps and offers to narrow it.
  if (!scope.project && isAccountPath(pathname)) return null;
  const label = scope.project ? scope.label : 'All apps';

  return (
    <>
      <span aria-hidden className="shrink-0 text-muted-foreground/40">
        /
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Project: ${label}. Switch project`}
          className="pressable flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand"
        >
          <span className={cn('truncate', !scope.project && 'text-muted-foreground')}>{label}</span>
          <NavArrowDown aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="label-mono text-muted-foreground">
            Projects
          </DropdownMenuLabel>
          {scope.choices.map((choice) => {
            const selected = choice.slug === scope.project;
            return (
              <DropdownMenuItem
                key={choice.slug}
                className="justify-between"
                onSelect={() => {
                  if (selected) return;
                  const target = switchTarget(pathname, choice.slug);
                  void navigate({ to: target.to, search: target.search } as never);
                }}
              >
                <span className="min-w-0 truncate">{choice.label}</span>
                <Check aria-hidden className={cn('h-3.5 w-3.5', !selected && 'invisible')} />
                {selected && <span className="sr-only">(current)</span>}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/dashboard/projects" search={{ project: undefined } as never}>
              <Folder aria-hidden className="h-3.5 w-3.5" />
              All projects
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              to="/dashboard/apps/new"
              search={{ source: 'import', project: undefined } as never}
            >
              <Upload aria-hidden className="h-3.5 w-3.5" />
              Import a repository
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
