import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { Markdown } from '@/components/docs/markdown';

describe('remarkDropHtmlComments', () => {
  it('keeps generator markers off the rendered page', async () => {
    const { container } = render(
      withRouter(
        <Markdown
          source={[
            '# Command tree',
            '',
            '<!-- BEGIN GENERATED: earlier names (TestCliTreeMigrationGuideFresh) -->',
            '',
            '| Old | New |',
            '|---|---|',
            '| `gregale doctor` | `gregale deploy check` |',
            '',
            '<!-- END GENERATED -->',
          ].join('\n')}
        />
      )
    );
    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('Command tree');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(container.textContent).not.toContain('<!--');
    expect(container.textContent).not.toContain('GENERATED');
  });
});
