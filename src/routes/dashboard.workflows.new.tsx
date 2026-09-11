import { createFileRoute } from '@tanstack/react-router';
import { NewAppWizard } from '@/components/dashboard/new-app-wizard';
import { pageHead } from '@/lib/seo';
import { validateNewAppSearch } from '@/components/dashboard/new-app-source';

export const Route = createFileRoute('/dashboard/workflows/new')({
  head: () => pageHead({ title: 'New app' }),
  // `?template=<slug>` prefills the wizard from the template gallery; an
  // unavailable slug lets the customer choose another starter or source.
  validateSearch: validateNewAppSearch,
  component: NewAppPage,
});

function NewAppPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <NewAppWizard search={search} onSearchChange={(next) => void navigate({ search: next })} />
  );
}
