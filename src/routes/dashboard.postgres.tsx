import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { PostgresDatabases } from '@/components/dashboard/postgres';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/postgres')({
  component: PostgresPage,
  head: () => consoleHead('postgres'),
});

function PostgresPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Postgres"
        description="Managed PostgreSQL databases, and the apps bound to them. Credentials are delivered to an app as a secret and never shown here."
      />
      <PostgresDatabases />
    </div>
  );
}
