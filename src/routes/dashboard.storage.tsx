import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { consoleHead } from '@/lib/seo';
import { ObjectStorage } from '@/components/dashboard/object-storage';

export const Route = createFileRoute('/dashboard/storage')({
  component: StoragePage,
  head: () => consoleHead('storage'),
});

function StoragePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Object storage"
        description="Private S3 buckets for your apps. Connect one to your code, or reach it from anywhere that speaks S3."
      />
      <ObjectStorage />
    </div>
  );
}
