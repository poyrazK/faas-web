import { DeploymentsPage } from '@/components/dashboard/pages/releases';
import { validateReleasesSearch } from '@/components/dashboard/releases-search';
import { consoleHead } from '@/lib/seo';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/releases')({
  component: DeploymentsPage,
  validateSearch: validateReleasesSearch,
  head: () => consoleHead('releases'),
});
