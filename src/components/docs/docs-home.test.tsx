import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { DocsIndex } from '@/components/docs/docs-index';

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
    for (const [name, href] of [
      [/Deploy your repository/, '/docs/deploy-from-github'],
      [/Add a Postgres database/, '/docs/postgres'],
      [/Store API keys and credentials/, '/docs/secrets'],
      [/Connect your domain/, '/docs/custom-domains'],
      [/See your app’s logs/, '/docs/logs'],
      [/Roll back a bad release/, '/docs/releases'],
      [/Run code on a schedule/, '/docs/crons'],
      [/Deploy from your coding agent/, '/docs/agents'],
    ] as const) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    const troubleshoot = screen.getAllByRole('link', { name: 'Fix a failed deploy' });
    expect(troubleshoot.length).toBeGreaterThanOrEqual(2); // help box and directory
    for (const link of troubleshoot) {
      expect(link).toHaveAttribute('href', '/docs/troubleshoot-deploys');
    }
    expect(screen.getByRole('button', { name: 'Copy commands' })).toBeInTheDocument();
  });
});
