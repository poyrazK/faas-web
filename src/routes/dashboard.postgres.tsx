import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { PostgresDatabases } from '@/components/dashboard/postgres';
import { consoleHead } from '@/lib/seo';
import { withCapability } from '@/components/dashboard/capability-gate';

export const Route = createFileRoute('/dashboard/postgres')({
  // Gated like its nav item: a bookmarked URL explains itself when off.
  component: withCapability('managed-postgres', 'Postgres', PostgresPage),
  head: () => consoleHead('postgres'),
  // The database open in the drawer, so it can be linked and Back closes it.
  validateSearch: (search: Record<string, unknown>): { db?: string } => ({
    db: typeof search.db === 'string' && search.db ? search.db.slice(0, 80) : undefined,
  }),
});

function PostgresPage() {
  const { db } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Postgres"
        help="Credentials are delivered to an app as a secret and never shown here."
      />
      <PostgresDatabases
        selected={db ?? null}
        onSelect={(id) =>
          void navigate({
            search: (current) => ({ ...current, db: id ?? undefined }),
            resetScroll: false,
          })
        }
      />
    </div>
  );
}
