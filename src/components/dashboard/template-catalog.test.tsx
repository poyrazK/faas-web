import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemplateCatalog } from './template-catalog';

vi.mock('@/lib/api/queries', () => ({
  useTemplates: () => ({
    data: [
      { name: 'hello-node', category: 'hello', description: 'minimal Node.js HTTP server' },
      { name: 'hello-python', category: 'hello', description: 'minimal Python HTTP server' },
      { name: 'function-go', category: 'function', description: 'the Go function contract' },
      {
        name: 'webhook-receiver',
        category: 'stateless-contract',
        description: 'verify, ack, queue',
      },
      { name: 'ai-chat', category: 'ai', description: 'streaming chat' },
    ],
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe('TemplateCatalog', () => {
  it('makes each starter one choice, named by its template, pressed when chosen', async () => {
    const onSelect = vi.fn();
    render(<TemplateCatalog selected="hello-python" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'hello-python' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const node = screen.getByRole('button', { name: 'hello-node' });
    expect(node).toHaveAttribute('aria-pressed', 'false');
    expect(node).toHaveAccessibleDescription(/minimal Node\.js HTTP server/);
    await userEvent.click(node);
    expect(onSelect).toHaveBeenCalledWith('hello-node');
  });

  it('names the runtime a starter is written in', () => {
    render(<TemplateCatalog onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'hello-node' })).toHaveTextContent('Node.js');
    expect(screen.getByRole('button', { name: 'function-go' })).toHaveTextContent('Go');
  });

  it('narrows the list by category, with counts', async () => {
    render(<TemplateCatalog onSelect={vi.fn()} />);
    const filters = screen.getByRole('group', { name: 'Filter starters' });
    expect(within(filters).getByRole('button', { name: /All/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await userEvent.click(within(filters).getByRole('button', { name: /Hello\s*2/ }));
    expect(screen.getByRole('button', { name: 'hello-node' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ai-chat' })).not.toBeInTheDocument();
  });

  // The CLI step is one command for the starter you chose, on one line,
  // not thirteen commands wrapped inside thirteen cards.
  it('shows the next step once, for the chosen starter, beside the way on', () => {
    const { rerender } = render(
      <TemplateCatalog onSelect={vi.fn()} action={<button type="button">Continue</button>} />
    );
    expect(screen.queryByText(/gregale init --template/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    rerender(
      <TemplateCatalog
        selected="hello-node"
        onSelect={vi.fn()}
        action={<button type="button">Continue</button>}
      />
    );
    const next = screen.getByRole('region', { name: 'Chosen starter' });
    expect(
      within(next).getByText('gregale init --template hello-node --path hello-node')
    ).toHaveClass('whitespace-nowrap');
    expect(
      within(next).getByRole('button', {
        name: 'Copy: gregale init --template hello-node --path hello-node',
      })
    ).toBeInTheDocument();
    expect(within(next).getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getAllByText(/gregale init --template/)).toHaveLength(1);
  });
});
