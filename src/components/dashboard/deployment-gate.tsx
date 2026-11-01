import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { EmptyState, Panel } from './primitives';

const COPY = {
  Invoke: {
    description: 'Requests become available after the app has a successful deployment to run.',
    message: 'Deploy this app before invoking it.',
  },
  Logs: {
    description: 'Log output becomes available once the app has a deployment that has finished.',
    message: 'Deploy this app before reading its logs.',
  },
} as const;

/**
 * Above the log stream while no deployment has gone live: the stream may
 * still hold what a failed boot printed, but a build failure's output is on
 * the deployment itself.
 */
export function NotLiveNotice({ slug }: { slug: string }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
    >
      No deployment has gone live yet. If the latest one started and then failed, what it printed is
      below. A build failure&rsquo;s output is on the deployment.{' '}
      <Link
        to="/dashboard/apps/$appSlug"
        params={{ appSlug: slug }}
        search={{ tab: 'Deployments' }}
        className="font-medium text-brand hover:underline"
      >
        View deployments
      </Link>
    </p>
  );
}

/** Shared empty state for app capabilities that need a runnable deployment. */
export function DeploymentGate({ slug, resource }: { slug: string; resource: keyof typeof COPY }) {
  const copy = COPY[resource];

  return (
    <Panel title={resource} description={copy.description}>
      <EmptyState
        message={copy.message}
        action={
          <Link
            to="/dashboard/apps/$appSlug"
            params={{ appSlug: slug }}
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
