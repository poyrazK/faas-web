import { createFileRoute } from '@tanstack/react-router';
import { LogsPage } from '@/components/dashboard/logs-page';
import { consoleHead } from '@/lib/seo';
import { validateLogsSearch } from '@/components/dashboard/logs-search';

export const Route = createFileRoute('/dashboard/logs')({
  component: LogsPage,
  head: () => consoleHead('logs'),
  validateSearch: validateLogsSearch,
});
