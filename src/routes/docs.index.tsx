import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/lib/seo';
import { DocsIndex } from '@/components/docs/docs-index';
import { DOCS_DESCRIPTION } from '@/lib/docs-manifest';

export const Route = createFileRoute('/docs/')({
  component: DocsIndex,
  head: () => pageHead({ title: 'Documentation', description: DOCS_DESCRIPTION }),
});
