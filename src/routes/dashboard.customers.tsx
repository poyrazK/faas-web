import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { Customers } from '@/components/dashboard/customers';
import { consoleHead } from '@/lib/seo';
import { withProductionBanner } from '@/components/dashboard/production-only-banner';

export const Route = createFileRoute('/dashboard/customers')({
  component: withProductionBanner('customers', CustomersPage),
  head: () => consoleHead('customers'),
});

function CustomersPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Customers" />
      <Customers />
    </div>
  );
}
