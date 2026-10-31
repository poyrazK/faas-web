import { createFileRoute } from '@tanstack/react-router';
import { EdgeRulesPage } from '@/components/dashboard/edge-rules-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/edge-rules')({
  component: EdgeRulesPage,
  head: () => consoleHead('edge-rules'),
});
