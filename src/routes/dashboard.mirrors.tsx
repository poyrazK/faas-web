import { createFileRoute } from '@tanstack/react-router';
import { MirrorsPage } from '@/components/dashboard/mirrors-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/mirrors')({
  component: MirrorsPage,
  head: () => consoleHead('mirrors'),
});
