import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { featureFlags } from '@/lib/feature-flags';
import { routeApi } from '@/test/monetization';
import { withRouter } from '@/test/router';
import { LimitsPage } from './limits-page';

vi.mock('./use-bill-facts', () => ({ useBillFacts: () => ({ settled: false }) }));
vi.mock('./your-bill', () => ({ YourBill: () => <p>Your bill section</p> }));
vi.mock('../capability-gate', () => ({
  CapabilityGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../budgets/budgets-page', () => ({ BudgetsSection: () => <p>Budgets section</p> }));
vi.mock('./integrations-section', () => ({
  IntegrationsSection: () => <p>Integrations section</p>,
}));
afterEach(() => vi.restoreAllMocks());

it('with the agents build flag off, no agent route is read and no Agents section renders', async () => {
  expect(featureFlags.agents).toBe(false);
  const spies = routeApi({});
  render(
    <QueryClientProvider client={new QueryClient()}>
      {withRouter(<LimitsPage />)}
    </QueryClientProvider>
  );
  expect(await screen.findByText('Budgets section')).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(screen.queryByText('Agents')).toBeNull();
  const paths = spies.GET.mock.calls.map(([path]) => path);
  expect(paths.filter((path) => String(path).includes('agent'))).toEqual([]);
});
