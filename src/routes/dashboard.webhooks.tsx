import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { useAuth } from '@/lib/auth';
import { consoleHead } from '@/lib/seo';
import { validateWebhookSearch, WebhooksHub } from '@/components/dashboard/pages/webhooks';

export const Route = createFileRoute('/dashboard/webhooks')({
  component: WebhooksPage,
  head: () => consoleHead('webhooks'),
  validateSearch: validateWebhookSearch,
});

function WebhooksPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  const { account } = useAuth();
  const { direction } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Webhooks"
        description={
          direction === 'inbound'
            ? 'Stripe events enter through verified, durable inbound endpoints.'
            : 'Signed outbound deliveries. Failed attempts back off and dead-letter after seven tries.'
        }
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="webhooks">
        <WebhooksHub
          accountId={account?.id ?? ''}
          slug={slug}
          direction={direction ?? 'outbound'}
          onDirection={(next) =>
            void navigate({ search: { direction: next === 'inbound' ? 'inbound' : undefined } })
          }
        />
      </AppScope>
    </div>
  );
}
