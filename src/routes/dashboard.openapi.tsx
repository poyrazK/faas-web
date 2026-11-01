import { createFileRoute } from '@tanstack/react-router';
import { OpenAPIPage } from '@/components/dashboard/openapi-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/openapi')({
  component: OpenAPIPage,
  head: () => consoleHead('openapi'),
});
