import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { docSource } from '@/lib/docs-content';
import { AuthLayout } from './auth-layout';

vi.mock('@/components/dotcut/dot-cut-canvas', () => ({ DotCutCanvas: () => null }));

it('qualifies the restore target and links to its published measurement boundary', async () => {
  render(withRouter(<AuthLayout>Sign in</AuthLayout>));
  const claim = await screen.findByRole('link', {
    name: /SSD platform-only snapshot-restore p95 target: below 350 ms/i,
  });
  expect(claim).toHaveAttribute('href', '/docs/scale-to-zero');
  const methodology = docSource('scale-to-zero');
  expect(methodology).toContain('first upstream byte');
  expect(methodology).toContain('Cloudflare');
  expect(methodology).toContain('fresh cold boot');
  expect(screen.queryByText('Cold start p50')).not.toBeInTheDocument();
});
