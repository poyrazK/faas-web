import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirstResponse } from './first-response';

afterEach(() => vi.unstubAllGlobals());

describe('first public response', () => {
  it('makes no request until asked, then confirms a readable successful GET without credentials', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    render(<FirstResponse endpoint="https://api.example" />);
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Request path'), 'health');
    await userEvent.click(screen.getByRole('button', { name: 'Send GET request' }));
    expect(await screen.findByRole('heading', { name: 'First response received' })).toBeVisible();
    expect(screen.getByText('{"ok":true}')).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example/health',
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        mode: 'cors',
        redirect: 'error',
        cache: 'no-store',
      })
    );
  });

  it('shows HTTP failures without calling them a successful verification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })));
    render(<FirstResponse endpoint="https://api.example" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send GET request' }));
    expect(await screen.findByText(/HTTP 404/)).toBeVisible();
    expect(screen.queryByText('First response received')).not.toBeInTheDocument();
  });

  it('explains unreadable requests and offers the public URL without claiming the app is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<FirstResponse endpoint="https://api.example" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send GET request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/CORS/);
    expect(screen.getByRole('link', { name: 'Open request URL' })).toHaveAttribute(
      'href',
      'https://api.example/'
    );
    expect(screen.queryByText('First response received')).not.toBeInTheDocument();
  });

  it('rejects paths that could target another host and clears stale success when the path changes', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<FirstResponse endpoint="https://api.example" />);
    await user.click(screen.getByRole('button', { name: 'Send GET request' }));
    await screen.findByText('First response received');
    await user.clear(screen.getByLabelText('Request path'));
    await user.type(screen.getByLabelText('Request path'), '//other.example');
    expect(screen.queryByText('First response received')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send GET request' })).toBeDisabled();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
});
