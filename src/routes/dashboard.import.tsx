import { createFileRoute, redirect } from '@tanstack/react-router';
import { validateNewAppSearch } from '@/components/dashboard/new-app-source';

export const Route = createFileRoute('/dashboard/import')({
  validateSearch: validateNewAppSearch,
  beforeLoad: ({ search, location }) => {
    throw redirect({
      to: '/dashboard/workflows/new',
      search: { ...search, source: 'import', step: undefined },
      hash: location.hash,
      replace: true,
    });
  },
});
