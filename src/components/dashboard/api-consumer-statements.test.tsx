import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi } from '@/test/monetization';
import { ConsumerStatements } from './api-consumer-statements';

const statement = (over: Record<string, unknown>) => ({
  id: 's-1',
  consumer_id: 'c-acme',
  period_start: '2026-09-01T00:00:00Z',
  period_end: '2026-10-01T00:00:00Z',
  revision: 1,
  status: 'draft',
  currency: 'EUR',
  billable_units: 1200,
  unpriced_units: 0,
  amount_millicents: 1_200_000,
  priced: true,
  buckets: [],
  as_of: '2026-10-01T00:05:00Z',
  created_at: '2026-10-02T00:00:00Z',
  finalized_at: null,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

it('finalizes a draft only after confirming that finalized statements are immutable', async () => {
  const spies = routeApi({
    'GET /v1/apps/{slug}/consumers/{consumer_id}/usage-statements': () => ({
      statements: [statement({})],
    }),
    'POST /v1/apps/{slug}/consumers/{consumer_id}/usage-statements/{statement_id}/finalize': () =>
      statement({ status: 'finalized', finalized_at: '2026-10-16T00:00:00Z' }),
  });
  renderWithProviders(<ConsumerStatements slug="api" consumerId="c-acme" />);
  expect(await screen.findByText('€12.00')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Finalize revision 1' }));
  let dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(/immutable/);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(spies.POST).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: 'Finalize revision 1' }));
  dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Finalize statement' }));
  await waitFor(() =>
    expect(spies.POST).toHaveBeenCalledWith(
      '/v1/apps/{slug}/consumers/{consumer_id}/usage-statements/{statement_id}/finalize',
      expect.objectContaining({
        params: expect.objectContaining({
          path: { slug: 'api', consumer_id: 'c-acme', statement_id: 's-1' },
        }),
      })
    )
  );
});

it('offers no finalize for an unpriced draft and explains why', async () => {
  routeApi({
    'GET /v1/apps/{slug}/consumers/{consumer_id}/usage-statements': () => ({
      statements: [statement({ priced: false, unpriced_units: 40 })],
    }),
  });
  renderWithProviders(<ConsumerStatements slug="api" consumerId="c-acme" />);
  await userEvent.click(await screen.findByText('Not fully priced'));
  expect(screen.queryByRole('button', { name: /Finalize revision/ })).not.toBeInTheDocument();
  expect(screen.getByText(/cannot be finalized/)).toBeInTheDocument();
});

it('reads the handoff receipt of a finalized statement, and says when there is none', async () => {
  let recorded = true;
  routeApi({
    'GET /v1/apps/{slug}/consumers/{consumer_id}/usage-statements': () => ({
      statements: [
        statement({ status: 'finalized', finalized_at: '2026-10-03T00:00:00Z' }),
        statement({
          id: 's-0',
          revision: 1,
          period_start: '2026-08-01T00:00:00Z',
          status: 'finalized',
        }),
      ],
    }),
    'GET /v1/apps/{slug}/consumers/{consumer_id}/usage-statements/{statement_id}/handoff': () =>
      recorded
        ? {
            id: 'h-1',
            statement_id: 's-1',
            external_invoice_id: 'INV-42',
            currency: 'EUR',
            amount_millicents: 1_200_000,
            created_at: '2026-10-04T00:00:00Z',
          }
        : problem(404, 'not_found'),
  });
  renderWithProviders(<ConsumerStatements slug="api" consumerId="c-acme" />);
  await userEvent.click((await screen.findAllByText(/2026-09-01 00:00 UTC/))[0]);
  expect(await screen.findByText('INV-42')).toBeInTheDocument();
  recorded = false;
  await userEvent.click(screen.getByText(/2026-08-01 00:00 UTC/));
  expect(await screen.findByText(/No handoff recorded/)).toBeInTheDocument();
});

it('snapshots the chosen UTC month', async () => {
  const spies = routeApi({
    'GET /v1/apps/{slug}/consumers/{consumer_id}/usage-statements': () => ({ statements: [] }),
    'POST /v1/apps/{slug}/consumers/{consumer_id}/usage-statements': () => statement({}),
  });
  renderWithProviders(<ConsumerStatements slug="api" consumerId="c-acme" />);
  expect(await screen.findByText(/No statements yet/)).toBeInTheDocument();
  const month = screen.getByLabelText('Statement period');
  await userEvent.clear(month);
  await userEvent.type(month, '2026-09');
  await userEvent.click(screen.getByRole('button', { name: 'Snapshot statement' }));
  await waitFor(() => expect(spies.POST).toHaveBeenCalled());
  const [, init] = spies.POST.mock.calls[0] as [string, { body: unknown }];
  expect(init.body).toEqual({
    period_start: '2026-09-01T00:00:00.000Z',
    period_end: '2026-10-01T00:00:00.000Z',
  });
});
