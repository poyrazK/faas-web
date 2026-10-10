import { lazy, Suspense } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { featureFlags } from '@/lib/feature-flags';
import { consoleHead } from '@/lib/seo';
import { LoadingState } from '@/components/dashboard/primitives';

/**
 * The import sits behind the literal flag on purpose. With the flag unset,
 * Rollup folds the condition to `false`, drops the `import()` and never emits
 * the canvas chunk or its CSS. A static import would keep both in `dist/`.
 */
const CanvasPage = featureFlags.canvas
  ? lazy(() => import('@/components/canvas/canvas-page'))
  : null;

type CanvasSearch = { node?: string };

export const Route = createFileRoute('/dashboard/canvas')({
  head: () => consoleHead('canvas'),
  validateSearch: (search: Record<string, unknown>): CanvasSearch =>
    typeof search.node === 'string' && search.node ? { node: search.node } : {},
  beforeLoad: () => {
    if (!featureFlags.canvas) throw redirect({ to: '/dashboard', replace: true });
  },
  component: CanvasRoute,
});

function CanvasRoute() {
  const { node } = Route.useSearch();
  if (!CanvasPage) return null;
  return (
    <Suspense fallback={<LoadingState message="Loading canvas…" className="m-6" />}>
      <CanvasPage node={node} />
    </Suspense>
  );
}
