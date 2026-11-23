import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityRegistry: () => ({
    phase: 'ready',
    query: {
      data: {
        capabilities: [
          { key: 'events', maturity: 'preview' },
          { key: 'edge-rules', maturity: 'beta' },
          { key: 'object-storage', maturity: 'ga' },
        ],
        hidden_capabilities: ['hidden'],
      },
    },
  }),
}));

import { NavMaturity } from './nav-access';

it('labels preview and beta destinations with the registry value', () => {
  render(
    <>
      <NavMaturity capabilities={['events']} />
      <NavMaturity capabilities={['edge-rules']} />
      <NavMaturity capabilities={['object-storage']} />
      <NavMaturity capabilities={['hidden', 'missing']} />
    </>
  );
  expect(screen.getByText('Preview')).toBeVisible();
  expect(screen.getByText('Beta')).toBeVisible();
  expect(screen.queryByText('GA')).not.toBeInTheDocument();
});
