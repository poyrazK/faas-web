import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { ConfirmProvider } from '@/components/ui/confirm';
import type { SupportTicket } from '@/lib/api/support';
import { SupportForm } from './support-form';
import { SupportConversation, SupportReply, SupportRating } from './support-conversation';
import { SupportGate, supportTextError } from './support-bits';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href="#" className={className}>
      {children}
    </a>
  ),
}));
const ok = (data: unknown) => ({ data, response: new Response() });
const scope = { accountId: 'alice', org: null };
const ticket: SupportTicket = {
  id: 'ticket',
  subject: 'Help deploying',
  category: 'deployment',
  status: 'open',
  revision: 4,
  context: {},
  can_reopen: false,
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:00:00Z',
};
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </QueryClientProvider>
  );
}
afterEach(() => vi.restoreAllMocks());

describe('support customer workflows', () => {
  it('does not call a preview API absent from an older capability registry', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ capabilities: [] }));
    render(
      <SupportGate scope={scope}>
        <SupportConversation scope={scope} id="ticket" />
      </SupportGate>,
      { wrapper }
    );
    expect(await screen.findByText('Not enabled for this account')).toBeInTheDocument();
    expect(get.mock.calls.map(([path]) => path)).toEqual(['/v1/capabilities']);
  });
  it('does not mount or fetch conversations when the preview is hidden', async () => {
    const get = spyApi('GET').mockResolvedValue(
      ok({ capabilities: [], hidden_capabilities: ['customer-support'] })
    );
    render(
      <SupportGate scope={scope}>
        <SupportConversation scope={scope} id="ticket" />
      </SupportGate>,
      { wrapper }
    );
    expect(await screen.findByText('Not enabled for this account')).toBeInTheDocument();
    expect(get.mock.calls.map(([path]) => path)).toEqual(['/v1/capabilities']);
  });

  it('validates the backend’s UTF-8 byte limits', () => {
    expect(supportTextError('é'.repeat(100), 200, 'Subject')).toBeUndefined();
    expect(supportTextError('é'.repeat(101), 200, 'Subject')).toContain('202');
    expect(supportTextError('😀'.repeat(2501), 10_000, 'Message')).toContain('10,004');
  });

  it('creates only explicitly entered context and keeps the form after a dropped response', async () => {
    const post = spyApi('POST')
      .mockRejectedValueOnce(new TypeError('connection dropped'))
      .mockResolvedValue(ok({ ticket_id: 'created', revision: 1, submission_id: 'receipt' }));
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<SupportForm scope={scope} onClose={vi.fn()} onCreated={onCreated} />, { wrapper });
    await user.type(screen.getByLabelText('Subject'), 'Deployment is failing');
    await user.type(screen.getByLabelText('Message'), 'The health check fails.');
    await user.click(screen.getByRole('button', { name: 'Send to support' }));
    await screen.findByRole('button', { name: 'Retry submission' });
    expect(screen.getByLabelText('Message')).toHaveValue('The health check fails.');
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: {
        subject: 'Deployment is failing',
        body: 'The health check fails.',
        category: 'deployment',
        priority: 'normal',
      },
    });
    expect((post.mock.calls[0]?.[1] as { body: object }).body).not.toHaveProperty('context');
    await user.click(screen.getByRole('button', { name: 'Retry submission' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('created'));
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
  });

  it('keeps a conflicted reply draft and does not silently resubmit', async () => {
    const post = spyApi('POST').mockResolvedValue({
      error: { status: 409, code: 'support_conflict', title: 'Changed' },
      response: new Response(null, { status: 409 }),
    });
    const user = userEvent.setup();
    const { rerender } = render(<SupportReply scope={scope} ticket={ticket} />, { wrapper });
    await user.type(screen.getByLabelText('Message'), 'My reply');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    await screen.findByRole('button', { name: 'Load latest conversation' });
    rerender(<SupportReply scope={scope} ticket={{ ...ticket, revision: 5 }} />);
    expect(screen.getByLabelText('Message')).toHaveValue('My reply');
    expect(screen.getByLabelText('Message')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Load latest conversation' }));
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeEnabled());
    expect(post).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toMatchObject({
      body: { expected_revision: 5, body: 'My reply' },
    });
  });

  it('honors server reopening eligibility and sends the reason at the current revision', async () => {
    const post = spyApi('POST').mockResolvedValue(
      ok({ ticket_id: 'ticket', revision: 5, submission_id: 'receipt' })
    );
    const user = userEvent.setup();
    const { rerender } = render(
      <SupportReply scope={scope} ticket={{ ...ticket, status: 'resolved', can_reopen: false }} />,
      { wrapper }
    );
    expect(screen.queryByRole('button', { name: 'Reopen conversation' })).not.toBeInTheDocument();
    rerender(
      <SupportReply scope={scope} ticket={{ ...ticket, status: 'resolved', can_reopen: true }} />
    );
    await user.type(screen.getByLabelText('What still needs help?'), 'Still failing');
    await user.click(screen.getByRole('button', { name: 'Reopen conversation' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/v1/support/tickets/{ticket}/reopen',
        expect.objectContaining({ body: { expected_revision: 4, body: 'Still failing' } })
      )
    );
  });

  it('asks before resolving and uses the current ticket revision', async () => {
    const post = spyApi('POST').mockResolvedValue(
      ok({ ticket_id: 'ticket', revision: 5, submission_id: 'receipt' })
    );
    const user = userEvent.setup();
    render(<SupportReply scope={scope} ticket={ticket} />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Mark resolved' }));
    expect(post).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(
      dialog.querySelector('button[type="submit"]') ??
        [...dialog.querySelectorAll('button')].find(
          (button) => button.textContent === 'Mark resolved'
        )!
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/v1/support/tickets/{ticket}/close',
        expect.objectContaining({ body: { expected_revision: 4 } })
      )
    );
  });

  it('rates the eligible resolution episode', async () => {
    spyApi('GET').mockResolvedValue(ok({ episode_id: 'episode-2', eligible: true }));
    const post = spyApi('POST').mockResolvedValue(ok({ episode_id: 'episode-2', rating: 5 }));
    const user = userEvent.setup();
    render(<SupportRating scope={scope} ticket="ticket" />, { wrapper });
    await screen.findByText('Rate this resolution');
    await user.click(screen.getByRole('radio', { name: '5' }));
    await user.click(screen.getByRole('button', { name: 'Send rating' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/v1/support/tickets/{ticket}/satisfaction',
        expect.objectContaining({ body: { episode_id: 'episode-2', rating: 5 } })
      )
    );
    expect(await screen.findByText('Thanks for your feedback.')).toBeInTheDocument();
  });

  it('renders plain text and acknowledges only after the final message page is displayed', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const post = spyApi('POST').mockResolvedValue(
      ok({ ticket_id: 'ticket', unread_count: 1, unread_total: 1 })
    );
    let sequence = 20;
    spyApi('GET').mockImplementation(async (path, options) => {
      if (path.endsWith('/notifications')) return ok({ items: [{ sequence }], unread_count: 1 });
      if (path.endsWith('/messages')) {
        const more = (options as { params: { query: { after?: number } } }).params.query.after;
        if (more) sequence = 99; // A later notification races the final message response.
        return ok({
          items: [
            {
              id: more ? 'second' : 'first',
              sequence: more ? 2 : 1,
              author: 'staff',
              body: '<img src=x onerror=alert(1)>',
              redacted: false,
              created_at: ticket.created_at,
            },
          ],
          ...(more ? {} : { next_cursor: 1 }),
        });
      }
      return ok(ticket);
    });
    const user = userEvent.setup();
    render(<SupportConversation scope={scope} id="ticket" />, { wrapper });
    await screen.findByText('<img src=x onerror=alert(1)>');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Read more messages' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { through_sequence: 20 } });
  });
});
