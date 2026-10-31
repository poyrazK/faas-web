import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ POST: vi.fn(() => new Promise(() => {})) }));
vi.mock('@/lib/api/client', async (o) => ({ ...(await o<object>()), api }));
const { DraftNode } = await import('./draft-node');

describe('DraftNode against a real mutation', () => {
  it('submits once while the create is pending', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DraftNode
          kind="domain"
          app={{ slug: 'acme-api', id: 'id-acme' }}
          onDone={vi.fn()}
          onCancel={vi.fn()}
        />
      </QueryClientProvider>
    );
    const input = screen.getByLabelText('Hostname');
    fireEvent.change(input, { target: { value: 'api.acme.dev' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 10));
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 10));
    expect(api.POST).toHaveBeenCalledTimes(1);
  });
});
