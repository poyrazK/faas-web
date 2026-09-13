import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { validateJobsSearch } from '@/components/dashboard/jobs-search';

export const Route = createFileRoute('/dashboard/triggers')({
  component: Outlet,
  validateSearch: validateJobsSearch,
  beforeLoad: ({ search, location }) => {
    if (location.pathname.replace(/\/+$/, '') !== '/dashboard/triggers') return;
    throw redirect({
      to: '/dashboard/jobs',
      search: { ...search, section: 'triggers' },
      hash: location.hash,
      replace: true,
    });
  },
});
