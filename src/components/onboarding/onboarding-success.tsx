import { Link } from '@tanstack/react-router';
import { CheckCircle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { publicAppUrl } from '@/lib/app-url';
import { onboardingEvent } from '@/lib/onboarding-events';
import { featureFlags } from '@/lib/feature-flags';
import { hasOnboarded } from '@/lib/auth';

/** Live deployment state, rather than a created app or a clicked link, owns this view. */
export function OnboardingSuccess({
  slug,
  endpoint,
  source,
  plan,
}: {
  slug: string;
  endpoint?: string | null;
  source: 'sample' | 'git' | 'existing';
  plan?: string;
}) {
  const href = publicAppUrl(endpoint);
  const command = href ? `curl '${href.replaceAll("'", '%27')}'` : '';
  return (
    <section className="flex flex-col gap-6" aria-label="Your app is live">
      <div className="flex items-center gap-3">
        <CheckCircle className="size-7 text-brand" />
        <h1 className="text-2xl font-semibold">Your app is live</h1>
      </div>
      <p className="text-sm text-muted-foreground">{slug} is ready. Open your app to try it.</p>
      {href ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="mb-2 text-xs text-muted-foreground">Your public URL</p>
          <div className="flex items-start gap-2">
            <a
              className="min-w-0 break-all font-mono text-sm text-brand underline"
              href={href}
              target="_blank"
              rel="noreferrer"
              onClick={() => onboardingEvent('endpoint_opened', { source, plan })}
            >
              {href}
            </a>
            <CopyIconButton text={href} label="App URL" />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-xs">{command}</code>
            <CopyIconButton text={command} label="curl command" />
          </div>
          <Button asChild className="mt-5">
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              onClick={() => onboardingEvent('endpoint_opened', { source, plan })}
            >
              Open app
            </a>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Opening the URL can wake the app and use your compute allowance. No paid console
            invocation is required.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This deployment has no public URL. Open the app to review its access settings.
        </p>
      )}
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
