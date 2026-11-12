import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { MaturityLabel } from '@/components/dashboard/maturity-label';
import { NotificationChannels } from '@/components/dashboard/notification-channels';
import {
  AlertsBody,
  validateAlertsSearch,
  type AlertsView,
} from '@/components/dashboard/pages/alerts';
import { PageHeader } from '@/components/dashboard/primitives';
import { Tabs, tabId } from '@/components/dashboard/tabs';
import { useCapability } from '@/lib/api/capabilities';
import { consoleHead } from '@/lib/seo';
import { createFileRoute } from '@tanstack/react-router';
import { useId } from 'react';

export const Route = createFileRoute('/dashboard/alerts')({
  component: AlertsPage,
  head: () => consoleHead('alerts'),
  validateSearch: validateAlertsSearch,
});

function AlertsPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  const { capability } = useCapability('alerts');
  const view: AlertsView = Route.useSearch().view ?? 'rules';
  const navigate = Route.useNavigate();
  const panelId = useId();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Alerts"
        help={
          view === 'channels'
            ? 'Slack, PagerDuty and email destinations for every alert rule on the account.'
            : 'Rules on your app metrics, SLOs and logs. A breach notifies the rule’s channels and its signed webhook.'
        }
        actions={
          <>
            <MaturityLabel capability={capability} />
            {view === 'rules' && <AppSelect slug={slug} onSelect={select} apps={apps} />}
          </>
        }
      />
      <Tabs
        label="Alerts"
        value={view}
        panelId={panelId}
        options={[
          { key: 'rules', label: 'Rules' },
          { key: 'channels', label: 'Channels' },
        ]}
        onChange={(next) =>
          void navigate({ search: next === 'channels' ? { view: 'channels' } : {}, replace: true })
        }
      />
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(panelId, view)}>
        {view === 'channels' ? (
          <NotificationChannels />
        ) : (
          <AppScope state={appState} resource="alert rules">
            <AlertsBody slug={slug} />
          </AppScope>
        )}
      </div>
    </div>
  );
}
