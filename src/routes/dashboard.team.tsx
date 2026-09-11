import { createFileRoute, redirect } from '@tanstack/react-router';
import { validateSettingsSearch } from '@/components/dashboard/settings-search';

export const Route = createFileRoute('/dashboard/team')({
  validateSearch: validateSettingsSearch,
  beforeLoad: ({ search, location }) => {
    throw redirect({
      to: '/dashboard/settings',
      search: { ...search, section: 'members' },
      hash: location.hash,
      replace: true,
    });
  },
});
