import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { EmptyState, Panel } from './primitives';

const COPY = {
  Invoke: {
    description: 'Requests become available after the app has a successful deployment to run.',
    message: 'Deploy this app before invoking it.',
  },
  Logs: {
    description: 'Log output becomes available after the app has a successful deployment to run.',
    message: 'Deploy this app before reading its logs.',
  },
} as const;

/** Shared empty state for app capabilities that need a runnable deployment. */
export function DeploymentGate({ slug, resource }: { slug: string; resource: keyof typeof COPY }) {
  const copy = COPY[resource];

  return (
    <Panel title={resource} description={copy.description}>
      <EmptyState
        message={copy.message}
        action={
          <Link
            to="/dashboard/workflows/$workflowId"
            params={{ workflowId: slug }}
            search={{ tab: 'Deployments' }}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            View deployments
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
    </Panel>
  );
}
