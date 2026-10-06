import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { DocsIndex } from '@/routes/docs.index';

describe('docs home', () => {
  it('offers a first-deployment path and task-specific entry points', async () => {
    render(withRouter(<DocsIndex />));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'From your code to a running API.'
    );
    expect(screen.getByRole('link', { name: /Start the guide/ })).toHaveAttribute(
      'href',
      '/docs/getting-started'
    );
    expect(screen.getByRole('link', { name: /Connect your domain/ })).toHaveAttribute(
      'href',
      '/docs/custom-domains'
    );
    expect(screen.getByRole('button', { name: 'Copy commands' })).toBeInTheDocument();
  });
});
