import { createFileRoute } from '@tanstack/react-router';
import { EventsBody } from '@/components/dashboard/events/events-body';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/events')({
  component: EventsBody,
  head: () => consoleHead('events'),
});
