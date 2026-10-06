import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { DocsSearch } from './docs-search';

describe('docs search', () => {
  it('opens with the keyboard and finds article content', async () => {
    const user = userEvent.setup();
    render(withRouter(<DocsSearch />));
    const input = await screen.findByRole('searchbox');
    await user.keyboard('/');
    expect(input).toHaveFocus();
    await user.type(input, 'source_ref_unavailable');
    const result = screen.getByRole('link', { name: /Deploy a GitHub source ref/ });
    expect(result).toHaveAttribute('href', '/docs/deploy-from-source');
    await user.keyboard('{ArrowDown}');
    expect(result).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('supports backward navigation and dismisses on outside focus', async () => {
    const user = userEvent.setup();
    render(
      withRouter(
        <>
          <DocsSearch />
          <button>Outside</button>
        </>
      )
    );
    const input = await screen.findByRole('searchbox');
    await user.type(input, 'deploy');
    const links = within(screen.getByRole('search')).getAllByRole('link');
    await user.keyboard('{ArrowUp}');
    expect(links.at(-1)).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('provides an empty state and clears the query', async () => {
    const user = userEvent.setup();
    render(withRouter(<DocsSearch />));
    const input = await screen.findByRole('searchbox');
    await user.type(input, 'qzzzx-unfindable');
    expect(screen.getByRole('status')).toHaveTextContent('No matching guides');
    await user.click(screen.getByRole('button', { name: 'Clear documentation search' }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });
});
