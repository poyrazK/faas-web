import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityGate } from './capability-gate';

const access = vi.hoisted(() => ({ value: 'on' as string }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: access.value, capability: undefined, refresh: vi.fn() }),
}));

describe('CapabilityGate', () => {
  it('renders children only when on, so their queries never run otherwise', () => {
    access.value = 'on';
    render(
      <CapabilityGate capability="traffic-mirroring" title="Mirrors">
        <p>body</p>
      </CapabilityGate>
    );
    expect(screen.getByText('body')).toBeInTheDocument();
  });
  it('says the feature is not enabled and links to Previews when off (deep link to a hidden tab)', () => {
    access.value = 'off';
    render(
      <CapabilityGate capability="traffic-mirroring" title="Mirrors">
        <p>body</p>
      </CapabilityGate>
    );
    expect(screen.queryByText('body')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/not enabled for this account/i);
    expect(screen.getByRole('link', { name: /previews/i })).toHaveAttribute(
      'href',
      '/dashboard/settings?section=previews'
    );
  });
  it('shows a spinner-free checking state while loading', () => {
    access.value = 'loading';
    render(
      <CapabilityGate capability="traffic-mirroring" title="Mirrors">
        <p>body</p>
      </CapabilityGate>
    );
    expect(screen.getByRole('status')).toHaveTextContent(/checking availability/i);
  });
});
