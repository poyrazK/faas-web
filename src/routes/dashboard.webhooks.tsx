import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { MaturityLabel } from '@/components/dashboard/maturity-label';
import { WebhooksHub, validateWebhookSearch } from '@/components/dashboard/pages/webhooks';
import { PageHeader } from '@/components/dashboard/primitives';
import { ReleaseWebhooks } from '@/components/dashboard/release-webhooks';
import { Tabs, tabId } from '@/components/dashboard/tabs';
import { useCapability } from '@/lib/api/capabilities';
import { useAuth } from '@/lib/auth';
import { consoleHead } from '@/lib/seo';
import { createFileRoute } from '@tanstack/react-router';
import { useId } from 'react';

export const Route = createFileRoute('/dashboard/webhooks')({
  component: WebhooksPage,
  head: () => consoleHead('webhooks'),
  validateSearch: validateWebhookSearch,
});

function WebhooksPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  const { account } = useAuth();
  const { direction, scope } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { capability } = useCapability('outbound-webhooks');
  const panelId = useId();
  const view = scope === 'account' ? 'account' : 'app';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Webhooks"
        help={
          view === 'account'
            ? 'Release events from every app on the account, signed and delivered to one receiver.'
            : direction === 'inbound'
              ? 'Stripe events enter through verified, durable inbound endpoints.'
              : 'Signed outbound deliveries. Failed attempts back off and dead-letter after seven tries.'
        }
        actions={
          <>
            <MaturityLabel capability={capability} />
            {view === 'app' && <AppSelect slug={slug} onSelect={select} apps={apps} />}
          </>
        }
      />
      <Tabs
        label="Webhooks"
        value={view}
        panelId={panelId}
        options={[
          { key: 'app', label: 'App webhooks' },
          { key: 'account', label: 'Account release webhooks' },
        ]}
        onChange={(next) =>
          void navigate({
            search: next === 'account' ? { scope: 'account' } : {},
            replace: true,
          })
        }
      />
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(panelId, view)}>
        {view === 'account' ? (
          <ReleaseWebhooks />
        ) : (
          <AppScope state={appState} resource="webhooks">
            <WebhooksHub
              accountId={account?.id ?? ''}
              slug={slug}
              direction={direction ?? 'outbound'}
              onDirection={(next) =>
                void navigate({
                  search: { direction: next === 'inbound' ? 'inbound' : undefined },
                })
              }
            />
          </AppScope>
        )}
      </div>
    </div>
  );
}
