import { createFileRoute, Link } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { WorkloadsBody } from '@/components/dashboard/jobs-workloads';
import { ScheduledRequestsBody } from '@/components/dashboard/jobs-scheduled';
import { TriggersBody } from '@/components/dashboard/jobs-triggers';
import {
  validateJobsSearch,
  type JobsSearch,
  type JobsSection,
} from '@/components/dashboard/jobs-search';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/jobs')({
  component: JobsPage,
  validateSearch: validateJobsSearch,
  head: () => consoleHead('jobs'),
});

const sections: { value: JobsSection; label: string }[] = [
  { value: 'workloads', label: 'Workloads' },
  { value: 'scheduled', label: 'Scheduled requests' },
  { value: 'triggers', label: 'Triggers' },
];

function JobsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const section = search.section ?? 'workloads';
  const onSelection = (patch: Partial<JobsSearch>) => {
    void navigate({ search: (current) => ({ ...current, ...patch }), hash: true });
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Jobs"
        description="Workloads, scheduled HTTP requests, and event triggers."
      />
      <nav aria-label="Jobs sections" className="flex flex-wrap gap-2 border-b border-border pb-3">
        {sections.map(({ value, label }) => (
          <Link
            key={value}
            to="/dashboard/jobs"
            search={(current) => ({ ...current, section: value })}
            hash
            aria-current={section === value ? 'page' : undefined}
            className={
              section === value
                ? 'rounded-md bg-muted px-3 py-2 text-sm font-medium'
                : 'rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {label}
          </Link>
        ))}
      </nav>
      {section === 'workloads' && <WorkloadsBody search={search} onSelection={onSelection} />}
      {section === 'scheduled' && (
        <ScheduledRequestsBody search={search} onSelection={onSelection} />
      )}
      {section === 'triggers' && <TriggersBody search={search} onSelection={onSelection} />}
    </div>
  );
}
