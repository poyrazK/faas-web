import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { PostgresDatabases } from '@/components/dashboard/postgres';
import { consoleHead } from '@/lib/seo';
import { withCapability } from '@/components/dashboard/capability-gate';

export const Route = createFileRoute('/dashboard/postgres')({
  // Gated like its nav item: a bookmarked URL explains itself when off.
  component: withCapability('managed-postgres', 'Postgres', PostgresPage),
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
