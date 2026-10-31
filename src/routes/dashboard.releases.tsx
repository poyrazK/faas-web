import { createFileRoute } from '@tanstack/react-router';
import { DeploymentsPage } from '@/components/dashboard/releases-page';
import { consoleHead } from '@/lib/seo';
import { validateReleasesSearch } from '@/components/dashboard/releases-search';

export const Route = createFileRoute('/dashboard/releases')({
  component: DeploymentsPage,
  validateSearch: validateReleasesSearch,
  head: () => consoleHead('releases'),
});
