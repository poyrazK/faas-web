import { createFileRoute } from '@tanstack/react-router';
import { ApisPage } from '@/components/dashboard/routes-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/routes')({
  component: ApisPage,
  head: () => consoleHead('routes'),
});
