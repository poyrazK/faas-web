import { createFileRoute } from '@tanstack/react-router';
import { UpstreamsPage } from '@/components/dashboard/upstreams-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/upstreams')({
  component: UpstreamsPage,
  head: () => consoleHead('upstreams'),
});
