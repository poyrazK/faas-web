import { useState } from 'react';
import { PageHeader } from '@/components/dashboard/primitives';
import { Tabs } from '@/components/dashboard/tabs';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { EventBacklogPanel, EventOverview } from './event-backlog';
import { PreviewEventDialog, PublishEventDialog } from './event-compose';
import { EventReceiptPanel, type Lookup } from './event-receipt';
import { EventConsumers } from './event-consumers';

export type EventsView = 'router' | 'consumers';
const VIEWS = [
  { key: 'router', label: 'Router' },
  { key: 'consumers', label: 'App consumers' },
] as const;

/**
 * The account's event router at a glance: what is waiting and why, how much
 * retained storage it costs, and — on request — where one event went, where
 * a new one would go, or a publication.
 *
 * Preview and publish sit behind the header actions rather than on the page:
 * one is a question, the other has side effects, and neither is something to
 * stumble into while reading the backlog.
 */
export function EventsBody({
  view: controlled,
  onView,
}: { view?: EventsView; onView?: (view: EventsView) => void } = {}) {
  const accountId = useAuth().account?.id ?? '';
  const [local, setLocal] = useState<EventsView>('router');
  const view = controlled ?? local;
  const changeView = onView ?? setLocal;
  const [dialog, setDialog] = useState<'preview' | 'publish' | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);

  const openReceipt = (next: { source: string; id: string }) => {
    setDialog(null);
    changeView('router');
    setLookup({ kind: 'event', ...next });
    // The receipt panel sits below the backlog; bring it into view.
    requestAnimationFrame(() =>
      document.getElementById('event-receipt')?.scrollIntoView({ block: 'start' })
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Events"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setDialog('preview')}>
              Preview routing
            </Button>
            <Button size="sm" onClick={() => setDialog('publish')}>
              Publish event
            </Button>
          </>
        }
      />
      <Tabs
        label="Events sections"
        panelId="events-panel"
        value={view}
        onChange={changeView}
        options={VIEWS}
      />
      <div id="events-panel" role="tabpanel" className="flex flex-col gap-6">
        {view === 'consumers' ? (
          <EventConsumers />
        ) : (
          <>
            <EventOverview accountId={accountId} />
            <EventBacklogPanel accountId={accountId} onOpenReceipt={openReceipt} />
            <div id="event-receipt" className="scroll-mt-6">
              <EventReceiptPanel accountId={accountId} lookup={lookup} onLookup={setLookup} />
            </div>
          </>
        )}
      </div>
      <PreviewEventDialog open={dialog === 'preview'} onClose={() => setDialog(null)} />
      <PublishEventDialog
        open={dialog === 'publish'}
        accountId={accountId}
        onClose={() => setDialog(null)}
        onViewReceipt={openReceipt}
      />
    </div>
  );
}
