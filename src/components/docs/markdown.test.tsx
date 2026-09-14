import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { Markdown } from './markdown';

it('resolves vendored plan links to published docs or their upstream source', async () => {
  render(
    withRouter(
      <Markdown
        sourcePath="docs/plans.md"
        source="[scale-to-zero](cold-wake.md#why-scale-to-zero-matters) and [limits](../pkg/api/limits.go) and [capabilities](capabilities.md)"
      />
    )
  );
  expect(await screen.findByRole('link', { name: 'scale-to-zero' })).toHaveAttribute(
    'href',
    '/docs/scale-to-zero#why-scale-to-zero-matters'
  );
  expect(screen.getByRole('link', { name: 'limits' })).toHaveAttribute(
    'href',
    'https://github.com/poyrazK/faas/blob/main/pkg/api/limits.go'
  );
  expect(screen.getByRole('link', { name: 'capabilities' })).toHaveAttribute(
    'href',
    'https://github.com/poyrazK/faas/blob/main/docs/capabilities.md'
  );
});
