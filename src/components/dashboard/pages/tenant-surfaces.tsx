import { TenantSurfaces } from '@/components/dashboard/tenant-surfaces';

export function TenantSurfacesBody({ slug }: { slug: string }) {
  return <TenantSurfaces slug={slug} />;
}
