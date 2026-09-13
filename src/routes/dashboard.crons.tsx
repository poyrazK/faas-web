import { createFileRoute, redirect } from '@tanstack/react-router';
import { validateJobsSearch } from '@/components/dashboard/jobs-search';

export const Route = createFileRoute('/dashboard/crons')({
  validateSearch: validateJobsSearch,
  beforeLoad: ({ search, location }) => {
    throw redirect({
      to: '/dashboard/jobs',
      search: { ...search, section: 'scheduled' },
      hash: location.hash,
      replace: true,
    });
  },
});
