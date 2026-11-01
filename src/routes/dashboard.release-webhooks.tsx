import { createFileRoute } from '@tanstack/react-router';
import { withCapability } from '@/components/dashboard/capability-gate';
import { ReleaseWebhooks } from '@/components/dashboard/release-webhooks';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/release-webhooks')({
  // Gated like its nav item: Free is not entitled (faas catalog plans), and a
  // bookmarked URL explains itself instead of calling a route that answers 402.
  component: withCapability('account-release-webhooks', 'Release webhooks', ReleaseWebhooks),
  head: () => consoleHead('release-webhooks'),
});
