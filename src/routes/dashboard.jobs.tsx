import { createFileRoute, Link } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { TabNav, tabClassName } from '@/components/dashboard/tabs';
import { WorkloadsBody } from '@/components/dashboard/jobs-workloads';
import { ScheduledRequestsBody } from '@/components/dashboard/jobs-scheduled';
import { TriggersBody } from '@/components/dashboard/jobs-triggers';
import { AutomationsBody } from '@/components/dashboard/automations-body';
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
  { value: 'automations', label: 'Automations' },
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
        description="Durable automations, workloads, scheduled HTTP requests, and event triggers."
      />
      <TabNav label="Jobs sections">
        {sections.map(({ value, label }) => (
          <Link
            key={value}
            to="/dashboard/jobs"
            search={(current) => ({ ...current, section: value })}
            hash
            aria-current={section === value ? 'page' : undefined}
            className={tabClassName(section === value)}
          >
            {label}
          </Link>
        ))}
      </TabNav>
      {section === 'workloads' && <WorkloadsBody search={search} onSelection={onSelection} />}
      {section === 'automations' && <AutomationsBody search={search} onSelection={onSelection} />}
      {section === 'scheduled' && (
        <ScheduledRequestsBody search={search} onSelection={onSelection} />
      )}
      {section === 'triggers' && <TriggersBody search={search} onSelection={onSelection} />}
    </div>
  );
}
