import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoutesBody } from './dashboard.apis';

vi.mock('@/lib/api/queries', () => ({
  useAppRoutes: () => ({
    data: {
      source: 'live',
      routes: [
        'GET /health',
        'GET /users/4f8a',
        'POST /users',
        'GET //elsewhere.test/path',
        '__route_other__',
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
  });

  it('does not offer external links until an app endpoint exists', () => {
    render(<RoutesBody slug="alpha" baseUrl="" />);
    expect(screen.queryByRole('link', { name: /open/i })).not.toBeInTheDocument();
  });
});
