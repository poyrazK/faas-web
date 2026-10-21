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

export const Route = createFileRoute('/dashboard/storage')({
  component: StoragePage,
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
        onSelectionChange={(next) =>
          void navigate({ search: next, replace: true, resetScroll: false })
        }
      />
    </div>
  );
}
