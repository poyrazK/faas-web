import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
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

it('colours a fenced shell block and copies it as plain text', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const source = '```sh\ngregale deploy --app api # first deploy\n```';
  const { container } = render(withRouter(<Markdown source={source} />));

  expect(await screen.findByText('gregale')).toHaveClass('hljs-title');
  expect(screen.getByText('--app')).toHaveClass('hljs-attr');
  expect(screen.getByText('# first deploy')).toHaveClass('hljs-comment');
  expect(container.querySelector('figcaption')).toHaveTextContent('sh');

  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  expect(writeText).toHaveBeenCalledWith('gregale deploy --app api # first deploy');
});

it('draws an unlabelled fence as a plain block, not an inline pill', async () => {
  const { container } = render(withRouter(<Markdown source={'```\nplain output\n```'} />));
  const code = await screen.findByText('plain output');
  expect(code.tagName).toBe('CODE');
  expect(code).toHaveClass('leading-relaxed');
  expect(code).not.toHaveClass('rounded', 'border');
  expect(container.querySelector('figcaption')).toHaveTextContent('text');
  expect(container.querySelector('[class*="hljs-"]')).toBeNull();
});

it('keeps inline code unhighlighted', async () => {
  render(withRouter(<Markdown source="Run `gregale deploy --app api` first." />));
  const code = await screen.findByText('gregale deploy --app api');
  expect(code).toHaveClass('rounded');
  expect(code.querySelector('[class*="hljs-"]')).toBeNull();
});
