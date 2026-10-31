import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ id: '', access: 'on' as string }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => {
    seen.id = id;
    return { access: seen.access, capability: undefined, refresh: vi.fn() };
  },
}));
const { MonetizationGate } = await import('./monetization-shared');

describe('MonetizationGate', () => {
  it('opens for an internal capability apid has released to the account', () => {
    // api-monetization is internal: never listed in capabilities[], so only
    // hidden_capabilities can say it is off (faas pkg/api/capabilities.go:39).
    seen.access = 'on';
    render(
      <MonetizationGate title="Consumers">
        <p>body</p>
      </MonetizationGate>
    );
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(seen.id).toBe('api-monetization');
  });
  it('gates on the capability it is given, such as platform tenants for Customers', () => {
    seen.access = 'off';
    render(
      <MonetizationGate title="Customers" capability="platform-tenants">
        <p>body</p>
      </MonetizationGate>
    );
    expect(seen.id).toBe('platform-tenants');
    expect(screen.queryByText('body')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/not enabled for this account/i);
  });
});
