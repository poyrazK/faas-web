import { createFileRoute } from '@tanstack/react-router';
import { validateReleasesSearch } from '@/components/dashboard/releases-search';
import { consoleHead } from '@/lib/seo';
import { DeploymentsPage } from '@/components/dashboard/pages/releases';

export const Route = createFileRoute('/dashboard/releases')({
  component: DeploymentsPage,
  validateSearch: validateReleasesSearch,
  head: () => consoleHead('releases'),
});
