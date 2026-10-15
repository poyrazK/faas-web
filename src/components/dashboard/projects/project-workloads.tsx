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
                {['Workload', 'App', 'App state', 'Build', 'Deployment', 'Rollout', 'Releases'].map(
                  (label) => (
                    <th key={label} className="px-4 py-3 font-medium" scope="col">
                      {label}
                    </th>
                  )
                )}
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
                      to="/dashboard/workflows/$workflowId"
                      params={{ workflowId: workload.slug }}
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
                    <Link
                      to="/dashboard/workflows/$workflowId"
                      params={{ workflowId: workload.slug }}
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
