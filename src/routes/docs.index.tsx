import { createFileRoute } from '@tanstack/react-router';
import { DocsIndex } from '@/components/docs/docs-home';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/docs/')({
  component: DocsIndex,
  head: () =>
    pageHead({
      title: 'Documentation',
      description:
        'Deploy your first Gregale app, connect a repository, and learn how to run, observe, and scale your backend.',
    }),
});
