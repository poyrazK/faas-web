import { lazy, Suspense } from 'react';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { pageHead } from '@/lib/seo';

// Dev-only. `import.meta.env.DEV` is a build-time constant, so the production
// bundle drops the import and the gallery never ships.
const Gallery = import.meta.env.DEV
  ? lazy(() => import('@/components/dashboard/kit/gallery'))
  : () => null;

export const Route = createFileRoute('/dashboard/kit')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => pageHead({ title: 'Component kit' }),
  component: KitPage,
});

function KitPage() {
  return (
    <Suspense fallback={null}>
      <Gallery />
    </Suspense>
  );
}
