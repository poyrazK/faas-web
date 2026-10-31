import { createFileRoute } from '@tanstack/react-router';
import { EnvPage } from '@/components/dashboard/env-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/env')({
  component: EnvPage,
  head: () => consoleHead('env'),
});
