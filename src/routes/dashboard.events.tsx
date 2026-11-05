import { createFileRoute } from '@tanstack/react-router';
import { EventsBody, type EventsView } from '@/components/dashboard/events/events-body';
import { consoleHead } from '@/lib/seo';
import { withCapability } from '@/components/dashboard/capability-gate';

export const Route = createFileRoute('/dashboard/events')({
  // Gated like its nav item: a bookmarked URL explains itself when off.
  component: withCapability('events', 'Events', EventsPage),
  head: () => consoleHead('events'),
  validateSearch: (search: Record<string, unknown>): { view?: 'consumers' } =>
    search.view === 'consumers' ? { view: 'consumers' } : {},
});

function EventsPage() {
  const { view } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <EventsBody
      view={view ?? 'router'}
      onView={(next: EventsView) =>
        void navigate({ search: next === 'consumers' ? { view: 'consumers' } : {}, replace: true })
      }
    />
  );
}
