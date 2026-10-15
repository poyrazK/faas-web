import { createFileRoute, Outlet } from '@tanstack/react-router';
import { consoleHead } from '@/lib/seo';
export const Route = createFileRoute('/dashboard/projects')({
  component: Outlet,
  head: () => consoleHead('projects'),
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === 'string' ? search.q.slice(0, 160) : undefined,
  }),
});
