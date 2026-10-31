import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Panel } from '../primitives';
import type { ProjectDetail } from '@/lib/api/projects';
export function ProjectWorkloads({ workloads }: Pick<ProjectDetail, 'workloads'>) {
  const [limit, setLimit] = useState(10);
  return (
    <Panel
      title="Workloads"
      description="Latest reported states. A saved project or successful build does not mean every workload is live."
    >
      {!workloads.length ? (
        <p className="p-4 text-sm text-muted-foreground">This project has no workloads.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Project workloads" className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                {[
                  'Workload',
                  'App',
                  'App state',
                  'Build',
                  'Deployment',
                  'Rollout',
                  'Calls',
                  'Releases',
                ].map((label) => (
                  <th key={label} className="px-4 py-3 font-medium" scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {workloads.slice(0, limit).map((workload) => (
                <tr key={workload.slug}>
                  <th scope="row" className="px-4 py-3 font-medium">
                    {workload.workload_name}
                  </th>
                  <td className="px-4 py-3">
                    <Link
                      to="/dashboard/apps/$appSlug"
                      params={{ appSlug: workload.slug }}
                      className="text-brand hover:underline"
                    >
                      {workload.slug}
                    </Link>
                  </td>
                  {[
                    workload.status,
                    workload.build_status,
                    workload.deployment_status,
                    workload.rollout_state,
                  ].map((status, index) => (
                    <td key={index} className="px-4 py-3">
                      {status || 'Unknown'}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    {workload.depends_on?.length ? (
                      workload.depends_on.join(', ')
                    ) : (
                      <span className="text-muted-foreground">None declared</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to="/dashboard/apps/$appSlug"
                      params={{ appSlug: workload.slug }}
                      search={{ tab: 'Deployments' }}
                      className="text-brand hover:underline"
                    >
                      View releases
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {workloads.length > 0 && (
        // depends_on is read from the app's declared service bindings
        // (faas handlers_projects.go:215, ADR-20261026193018); the API refuses
        // edits to them on project apps as source-managed.
        <p className="border-t border-border p-4 text-xs text-muted-foreground">
          Calls are the services a workload declares with <code>depends_on</code> in the
          repository's Compose file or <code>.gregale/project.yaml</code>. They change on the next
          deploy from the repository, not here, and a service under the <code>project</code> policy
          can call its siblings without declaring them.
        </p>
      )}
      {workloads.length > limit && (
        <div className="p-4">
          <Button variant="outline" size="sm" onClick={() => setLimit(limit + 10)}>
            Show 10 more workloads
          </Button>
        </div>
      )}
    </Panel>
  );
}
