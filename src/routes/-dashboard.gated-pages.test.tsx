import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: 'off', capability: undefined, refresh: vi.fn() }),
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (options: unknown) => ({ options }),
}));

describe('pages gated like their nav items', () => {
  it.each([
    ['./dashboard.events', 'Events'],
    ['./dashboard.integrations', 'Integrations'],
    ['./dashboard.storage', 'Storage'],
    ['./dashboard.postgres', 'Postgres'],
  ])('%s explains instead of mounting when the capability is off', async (path) => {
    const { Route } = (await import(/* @vite-ignore */ path)) as {
      Route: { options: { component: React.ComponentType } };
    };
    const Page = Route.options.component;
    render(<Page />);
    expect(screen.getByRole('status')).toHaveTextContent(/not enabled for this account/i);
  });
});
