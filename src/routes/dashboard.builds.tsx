import { createFileRoute, redirect } from '@tanstack/react-router';
import { validateReleasesSearch } from '@/components/dashboard/releases-search';

export const Route = createFileRoute('/dashboard/builds')({
  validateSearch: validateReleasesSearch,
  beforeLoad: ({ search, location }) => {
    throw redirect({
      to: '/dashboard/deployments',
      search: { ...search, view: 'builds' },
      hash: location.hash,
      replace: true,
    });
  },
});
