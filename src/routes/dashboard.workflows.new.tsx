import { createFileRoute } from '@tanstack/react-router';
import { NewAppWizard } from '@/components/dashboard/new-app-wizard';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/workflows/new')({
  head: () => pageHead({ title: 'New workflow' }),
  // `?template=<slug>` prefills the wizard from the template gallery; an
  // unknown slug degrades to the plain wizard rather than an error.
  validateSearch: (search: Record<string, unknown>): { template?: string } =>
    typeof search.template === 'string' ? { template: search.template } : {},
  component: NewFunctionPage,
});

function NewFunctionPage() {
  const { template } = Route.useSearch();
  return <NewAppWizard templateSlug={template} />;
}
