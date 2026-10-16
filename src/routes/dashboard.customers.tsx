import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { Customers } from '@/components/dashboard/customers';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/customers')({
  component: CustomersPage,
  head: () => consoleHead('customers'),
});

function CustomersPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="Your end customers across apps: their linked consumers and hostnames, prices, usage and statements."
      />
      <Customers />
    </div>
  );
}
