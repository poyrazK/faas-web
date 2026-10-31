import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { consoleHead } from '@/lib/seo';
import {
  ObjectStorage,
  type StorageSelection,
  type StorageTab,
} from '@/components/dashboard/object-storage';

const TABS: readonly StorageTab[] = ['objects', 'code', 'settings'];
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
import { withCapability } from '@/components/dashboard/capability-gate';

export const Route = createFileRoute('/dashboard/storage')({
  // Gated like its nav item: a bookmarked URL explains itself when off.
  component: withCapability('object-storage', 'Storage', StoragePage),
  head: () => consoleHead('storage'),
  validateSearch: (search: Record<string, unknown>): StorageSelection => {
    const tab = TABS.find((t) => t === search.tab);
    const out: StorageSelection = {
      app: text(search.app),
      bucket: text(search.bucket),
      tab,
      prefix: text(search.prefix),
    };
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
  },
});

function StoragePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Object storage"
        description="Private S3 buckets for your apps. Connect one to your code, or reach it from anywhere that speaks S3."
      />
      <ObjectStorage
        selection={search}
        // A choice someone makes is a Back step; only a change the page makes
        // on its own replaces the entry, so Back never lands on a URL that
        // immediately moves again.
        onSelectionChange={(next, options) =>
          void navigate({ search: next, replace: options?.replace ?? false, resetScroll: false })
        }
      />
    </div>
  );
}
