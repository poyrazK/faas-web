import { createFileRoute } from '@tanstack/react-router';
import { LimitsPage } from '@/components/dashboard/limits/limits-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/limits')({
  component: LimitsPage,
  head: () => consoleHead('limits'),
});
