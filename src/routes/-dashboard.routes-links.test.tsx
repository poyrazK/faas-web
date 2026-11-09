import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoutesBody } from '@/components/dashboard/pages/routes';

const app = vi.hoisted(() => ({ route_metrics_enabled: true as boolean | undefined }));
const source = vi.hoisted(() => ({ value: 'live' }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
  }) => (
    <a
      href={`${to.replace('$appSlug', params?.appSlug ?? '')}${search ? `?${new URLSearchParams(search as Record<string, string>)}` : ''}`}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/lib/api/queries', () => ({
  useApp: () => ({ data: { id: 'app-1', slug: 'alpha', ...app } }),
  useDomains: () => ({
    data: [
      { domain: 'api.alpha.test', app_id: 'app-1', verified: true },
      { domain: 'pending.alpha.test', app_id: 'app-1', verified: false },
      { domain: 'other.test', app_id: 'app-2', verified: true },
    ],
  }),
  useAppRoutes: () => ({
    data: {
      app_id: 'app-1',
      source: source.value,
      cap_hit: false,
      routes: [
        'GET /health',
        'GET /users/4f8a',
        'POST /users',
        'GET //elsewhere.test/path',
        '__route_other__',
        'GET /users/{id}',
      ],
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe('API route links', () => {
  it('opens observed paths on the selected app and keeps unsafe paths as text', () => {
    render(<RoutesBody slug="alpha" baseUrl="https://alpha.example.test" />);

    expect(screen.getByRole('link', { name: 'Open GET /health' })).toHaveAttribute(
      'href',
      'https://alpha.example.test/health'
    );
    expect(screen.getByRole('link', { name: 'Open GET /users/4f8a' })).toHaveAttribute(
      'href',
      'https://alpha.example.test/users/4f8a'
    );
    expect(screen.getByRole('button', { name: 'Copy: POST /users URL' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /POST/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /elsewhere/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /route_other/ })).not.toBeInTheDocument();
    // A template is not a page anyone can open, so it is copied instead.
    expect(screen.queryByRole('link', { name: 'Open GET /users/{id}' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy: GET /users/{id} URL' })).toBeInTheDocument();
  });

  it('opens with which addresses reach the app and how many routes had traffic', () => {
    render(<RoutesBody slug="alpha" baseUrl="https://alpha.example.test" />);
    expect(screen.getByText('5 routes on alpha have had traffic.')).toBeInTheDocument();
    // Its own address and its verified custom domain; not a pending one or another app's.
    expect(screen.getByText(/Requests reach it at/)).toHaveTextContent(
      'Requests reach it at alpha.example.test and api.alpha.test.'
    );
    expect(screen.getByText('Other routes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a domain' })).toHaveAttribute(
      'href',
      '/dashboard/domains?add=true'
    );
  });

  it('sends an app with route tracking off to the setting that turns it on', () => {
    app.route_metrics_enabled = false;
    try {
      render(<RoutesBody slug="alpha" baseUrl="https://alpha.example.test" />);
      expect(
        screen.getByText('Route tracking is off for alpha, so its routes aren’t listed.')
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Turn on route tracking' })).toHaveAttribute(
        'href',
        '/dashboard/apps/alpha?tab=Runtime'
      );
    } finally {
      app.route_metrics_enabled = true;
    }
  });

  it('does not call an unreadable list a plan limit', () => {
    source.value = 'unavailable';
    try {
      render(<RoutesBody slug="alpha" baseUrl="https://alpha.example.test" />);
      expect(screen.getByText('alpha’s routes can’t be listed right now.')).toBeInTheDocument();
      expect(screen.queryByText(/paid plan/i)).toBeNull();
      expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    } finally {
      source.value = 'live';
    }
  });

  it('does not offer external links until an app endpoint exists', () => {
    render(<RoutesBody slug="alpha" baseUrl="" />);
    expect(screen.queryByRole('link', { name: /open/i })).not.toBeInTheDocument();
  });
});
