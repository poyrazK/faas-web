import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const access = vi.hoisted(() => ({ value: 'off' as string }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: access.value, refresh: vi.fn() }),
}));
const panel = vi.hoisted(() => vi.fn(() => null));
vi.mock('./supply-chain-panel', async (original) => ({
  ...(await original<typeof import('./supply-chain-panel')>()),
  SupplyChainPanel: panel,
}));
const { GatedSupplyChainPanel } = await import('./supply-chain-gate');

describe('GatedSupplyChainPanel', () => {
  it('leaves signed deploys out entirely when the account does not have them', () => {
    // signed-deploys is internal; capgate answers 404 to PATCH /security when off.
    access.value = 'off';
    const { container } = render(<GatedSupplyChainPanel slug="alpha" />);
    expect(container).toBeEmptyDOMElement();
    expect(panel).not.toHaveBeenCalled();
  });
  it('shows the panel when signed deploys are released to the account', () => {
    access.value = 'on';
    render(<GatedSupplyChainPanel slug="alpha" />);
    expect(panel).toHaveBeenCalled();
  });
});
