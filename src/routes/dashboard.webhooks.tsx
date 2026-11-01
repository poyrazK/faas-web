import { createFileRoute } from '@tanstack/react-router';
import { WebhooksPage } from '@/components/dashboard/webhooks-page';
import { consoleHead } from '@/lib/seo';
import { validateWebhookSearch } from '@/components/dashboard/webhooks-search';

export const Route = createFileRoute('/dashboard/webhooks')({
  component: WebhooksPage,
  head: () => consoleHead('webhooks'),
  validateSearch: validateWebhookSearch,
});
