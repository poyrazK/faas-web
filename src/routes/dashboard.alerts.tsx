import { createFileRoute } from '@tanstack/react-router';
import { AlertsPage } from '@/components/dashboard/alerts-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/alerts')({
  component: AlertsPage,
  head: () => consoleHead('alerts'),
});
