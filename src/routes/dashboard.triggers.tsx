import { createFileRoute, redirect } from '@tanstack/react-router';
import { validateJobsSearch } from '@/components/dashboard/jobs-search';

export const Route = createFileRoute('/dashboard/triggers')({
  validateSearch: validateJobsSearch,
  beforeLoad: ({ search, location }) => {
    throw redirect({
      to: '/dashboard/jobs',
      search: { ...search, section: 'triggers' },
      hash: location.hash,
      replace: true,
    });
  },
});
