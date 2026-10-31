import { createFileRoute } from '@tanstack/react-router';
import { SecretsPage } from '@/components/dashboard/secrets-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/secrets')({
  component: SecretsPage,
  head: () => consoleHead('secrets'),
});
