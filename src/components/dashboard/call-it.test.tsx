import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CallIt, callInstructions } from './call-it';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    className?: string;
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (out, [key, value]) => out.replace(`$${key}`, value),
      to
    );
    const query = search ? `?${new URLSearchParams(search)}` : '';
    return (
      <a href={`${path}${query}`} className={className}>
        {children}
      </a>
    );
  },
}));

const app = {
  slug: 'orders-api',
  type: 'app' as const,
  visibility: 'public' as const,
  url: 'https://orders-api.gregale.dev',
};

describe('callInstructions', () => {
  it('calls an open app with a bare curl and tails logs with the CLI', () => {
    expect(callInstructions(app)).toEqual({
      curl: 'curl -i https://orders-api.gregale.dev',
      auth: undefined,
      ipAllowlist: false,
      internal: false,
      logs: 'gregale logs orders-api --follow',
    });
  });

  it.each([
    [{ require_authn: true }, `-H 'Authorization: Bearer <API_KEY>'`, 'api-key'],
    [
      { public_auth: { mode: 'bearer', has_basic_creds: false } },
      `-H 'Authorization: Bearer <API_KEY>'`,
      'api-key',
    ],
    [
      { public_auth: { mode: 'basic', has_basic_creds: true } },
      `-u '<username>:<password>'`,
      'basic',
    ],
    [
      { consumer_auth_mode: 'required' },
      `-H 'Authorization: Bearer <CONSUMER_KEY>'`,
      'consumer-key',
    ],
  ] as const)('adds the credential an app demands (%j)', (access, flag, auth) => {
    const call = callInstructions({ ...app, ...access });
    expect(call.curl).toBe(`curl -i ${flag} https://orders-api.gregale.dev`);
    expect(call.auth).toBe(auth);
  });

  it('notes an IP allowlist without inventing a header', () => {
    const call = callInstructions({
      ...app,
      public_auth: { mode: 'ip_allowlist', has_basic_creds: false, ip_allowlist_entry_count: 2 },
    });
    expect(call.curl).toBe('curl -i https://orders-api.gregale.dev');
    expect(call.ipAllowlist).toBe(true);
  });

  it.each([
    { visibility: 'internal' as const, url: '' },
    { public_auth: { mode: 'internal_only' as const, has_basic_creds: false } },
  ])('offers no public request for an internal app (%j)', (access) => {
    const call = callInstructions({ ...app, ...access });
    expect(call.curl).toBeUndefined();
    expect(call.internal).toBe(true);
  });
});

describe('CallIt', () => {
  it('shows a copyable request, the CLI tail, and links to Invoke and Logs', () => {
    render(<CallIt app={app} />);
    expect(screen.getByRole('heading', { name: 'Call it' })).toBeInTheDocument();
    expect(screen.getByText('curl -i https://orders-api.gregale.dev')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy: curl command' })).toBeInTheDocument();
    expect(screen.getByText('gregale logs orders-api --follow')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the Invoke tab' })).toHaveAttribute(
      'href',
      '/dashboard/apps/orders-api?tab=Invoke'
    );
    expect(screen.getByRole('link', { name: 'View logs' })).toHaveAttribute(
      'href',
      '/dashboard/apps/orders-api?tab=Logs'
    );
  });

  it('shows the header form with a placeholder for an authenticated app, never a secret', () => {
    render(<CallIt app={{ ...app, public_auth: { mode: 'bearer', has_basic_creds: false } }} />);
    expect(
      screen.getByText(
        `curl -i -H 'Authorization: Bearer <API_KEY>' https://orders-api.gregale.dev`
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/replace <API_KEY> with an API key from this account/)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'API keys' })).toHaveAttribute(
      'href',
      '/dashboard/settings?section=api-keys'
    );
  });

  it('describes the function contract for a function', () => {
    render(<CallIt app={{ ...app, type: 'function' }} />);
    expect(screen.getByText(/handler receives the request/)).toBeInTheDocument();
  });

  it('says an internal app has no public URL but keeps logs and Invoke', () => {
    render(<CallIt app={{ ...app, visibility: 'internal', url: '' }} />);
    expect(screen.queryByText(/^curl/)).not.toBeInTheDocument();
    expect(screen.getByText(/Internal service only: there is no public URL/)).toBeInTheDocument();
    expect(screen.getByText('gregale logs orders-api --follow')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the Invoke tab' })).toBeInTheDocument();
  });
});
