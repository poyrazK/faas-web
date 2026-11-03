import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ErrorComponentProps } from '@tanstack/react-router';

const flags = vi.hoisted(() => ({ errorReporting: false }));
const reportError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }));
vi.mock('@/lib/error-reporting', () => ({ reportError }));
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const { RouteError } = await import('./route-status');

afterEach(() => {
  flags.errorReporting = false;
  reportError.mockReset();
});

function renderError(error: unknown) {
  render(<RouteError {...({ error, reset: vi.fn() } as unknown as ErrorComponentProps)} />);
}

describe('RouteError', () => {
  it('hands the route’s error to the reporter when the flag is on', () => {
    flags.errorReporting = true;
    const error = new Error('loader exploded');
    renderError(error);
    expect(screen.getByRole('alert')).toHaveTextContent('This page hit an error.');
    expect(reportError).toHaveBeenCalledWith('route', error);
  });

  it('reports nothing while the flag is off', () => {
    renderError(new Error('loader exploded'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(reportError).not.toHaveBeenCalled();
  });
});
