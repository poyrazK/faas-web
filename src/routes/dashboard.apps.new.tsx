import { createFileRoute } from '@tanstack/react-router';
import { NewAppWizard } from '@/components/dashboard/new-app-wizard';
import { DevLayoutSwitch, useNewAppLayout } from '@/components/dashboard/new-app-layout';
import { pageHead } from '@/lib/seo';
import { validateNewAppSearch } from '@/components/dashboard/new-app-source';

export const Route = createFileRoute('/dashboard/apps/new')({
  head: () => pageHead({ title: 'New app' }),
  // `?template=<slug>` prefills the wizard from the template gallery; an
  // unavailable slug lets the customer choose another starter or source.
  validateSearch: validateNewAppSearch,
  component: NewAppPage,
});

function NewAppPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [layout, setLayout] = useNewAppLayout();
  return (
    <>
      <NewAppWizard
        layout={layout}
        search={search}
        onSearchChange={(next, options) => void navigate({ search: next, ...options })}
      />
      <DevLayoutSwitch layout={layout} onChange={setLayout} />
    </>
  );
}
