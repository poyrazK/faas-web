import { createFileRoute } from '@tanstack/react-router';
import { TenantSurfacesPage } from '@/components/dashboard/tenant-surfaces-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/tenant-surfaces')({
  component: TenantSurfacesPage,
  head: () => consoleHead('tenant-surfaces'),
});
