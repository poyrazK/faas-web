import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import type { BillData } from './use-bill-facts';
import { LimitsSummary } from './limits-summary';

const data = vi.hoisted(() => ({ current: {} as unknown }));
vi.mock('./use-bill-facts', () => ({ useBillFacts: () => data.current }));

const ready = <T extends object>(t: T) => ({ state: 'ready' as const, ...t });

it('says where the limits stand in one line and links to them', async () => {
  data.current = {
    settled: true,
    facts: {
      workspace: 'personal',
      plan: 'pro',
      cap: ready({ capCents: 5000, overageCents: 1240 }),
      egress: ready({ enabled: false, electable: true, usedGb: 410, includedGb: 500 }),
      storage: { state: 'hidden' },
    },
  } satisfies Partial<BillData>;
  render(withRouter(<LimitsSummary />));
  const line = await screen.findByRole('status', { name: 'Spending limits' });
  expect(line).toHaveTextContent('Close to a limit');
  expect(line).toHaveTextContent('Egress is at 82% of 500 GiB.');
  expect(screen.getByRole('link', { name: 'Open spending limits' })).toHaveAttribute(
    'href',
    '/dashboard/limits'
  );
});

it('waits rather than guess while reads load', async () => {
  data.current = { settled: false } satisfies Partial<BillData>;
  render(withRouter(<LimitsSummary />));
  expect(await screen.findByRole('status', { name: 'Spending limits' })).toHaveTextContent(
    'Checking the limits…'
  );
});
