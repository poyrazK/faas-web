import { createFileRoute } from '@tanstack/react-router';
import { EventsBody } from '@/components/dashboard/events/events-body';
import { consoleHead } from '@/lib/seo';
import { withCapability } from '@/components/dashboard/capability-gate';

export const Route = createFileRoute('/dashboard/events')({
  // Gated like its nav item: a bookmarked URL explains itself when off.
  component: withCapability('events', 'Events', EventsBody),
  head: () => consoleHead('events'),
});
