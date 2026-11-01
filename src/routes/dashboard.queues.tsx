import { createFileRoute } from '@tanstack/react-router';
import { QueuesPage } from '@/components/dashboard/queues-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/queues')({
  component: QueuesPage,
  head: () => consoleHead('queues'),
});
