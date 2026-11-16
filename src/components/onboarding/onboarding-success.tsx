import { Link } from '@tanstack/react-router';
import { CheckCircle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FirstResponse } from '@/components/dashboard/first-response';
import type { App, Deployment } from '@/lib/api/queries';
import { featureFlags } from '@/lib/feature-flags';
import { hasOnboarded } from '@/lib/auth';
import { onboardingEvent } from '@/lib/onboarding-events';

/** Live deployment state, rather than a created app or a clicked link, owns this view. */
export function OnboardingSuccess({
  slug,
  endpoint,
  app,
  deployment,
  source,
  plan,
}: {
  slug: string;
  endpoint?: string | null;
  source: 'sample' | 'git' | 'existing';
  plan?: string;
  app: App;
  deployment: Deployment;
}) {
  return (
    <section className="flex flex-col gap-6" aria-label="Deployment ready">
      <div className="flex items-center gap-3">
        <CheckCircle className="size-7 text-brand" />
        <h1 className="text-2xl font-semibold">Deployment ready</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        {slug} is deployed. Use the checks below to confirm your application is working.
      </p>
      <FirstResponse
        slug={slug}
        endpoint={endpoint}
        app={app}
        deployment={deployment}
        onPublicOpen={() => onboardingEvent('endpoint_opened', { source, plan })}
      />
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link to="/dashboard/apps/$appSlug" params={{ appSlug: slug }} search={{ tab: 'Logs' }}>
            View logs
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/dashboard/apps/$appSlug" params={{ appSlug: slug }}>
            View app
          </Link>
        </Button>
        {(featureFlags.onboardingV2 || hasOnboarded()) && (
          <Button asChild variant="outline">
            <Link to="/dashboard">Continue to console</Link>
          </Button>
        )}
      </div>
      <Link
        to="/dashboard/apps/new"
        search={{ source: 'git' }}
        className="text-sm text-brand underline"
      >
        Deploy your own code
      </Link>
    </section>
  );
}
