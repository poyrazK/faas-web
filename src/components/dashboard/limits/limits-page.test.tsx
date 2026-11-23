import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { LimitsPage } from './limits-page';

const flags = vi.hoisted(() => ({ agents: false }));
vi.mock('@/lib/feature-flags', () => ({
  featureFlags: {
    get agents() {
      return flags.agents;
    },
  },
}));
vi.mock('./agents-section', () => ({
  AgentsSection: () => <p>Agents section</p>,
  AgentAwareStrip: () => <p>Agent-aware strip</p>,
}));

vi.mock('./use-bill-facts', () => ({ useBillFacts: () => ({ settled: false }) }));
vi.mock('./status-strip', () => ({ StatusStrip: () => <p>Strip</p> }));
vi.mock('./your-bill', () => ({ YourBill: () => <p>Your bill section</p> }));
vi.mock('../capability-gate', () => ({
  CapabilityGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../budgets/budgets-page', () => ({ BudgetsSection: () => <p>Budgets section</p> }));
vi.mock('./integrations-section', () => ({
  IntegrationsSection: () => <p>Integrations section</p>,
}));

it('answers first, then Your bill, then budgets', async () => {
  render(withRouter(<LimitsPage />));
  expect(await screen.findByRole('heading', { name: 'Spending limits' })).toBeInTheDocument();
  const [strip, bill, budgets] = ['Strip', 'Your bill section', 'Budgets section'].map((text) =>
    screen.getByText(text)
  );
  expect(strip.compareDocumentPosition(bill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(bill.compareDocumentPosition(budgets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('with the agents flag off, nothing about agents renders', async () => {
  flags.agents = false;
  render(withRouter(<LimitsPage />));
  expect(await screen.findByText('Strip')).toBeInTheDocument();
  expect(screen.queryByText('Agents section')).toBeNull();
  expect(screen.queryByText('Agent-aware strip')).toBeNull();
});

it('with the agents flag on, agents follow budgets and the strip counts them', async () => {
  flags.agents = true;
  render(withRouter(<LimitsPage />));
  expect(await screen.findByText('Agent-aware strip')).toBeInTheDocument();
  expect(screen.queryByText('Strip')).toBeNull();
  const budgets = screen.getByText('Budgets section');
  const agents = screen.getByText('Agents section');
  expect(budgets.compareDocumentPosition(agents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  flags.agents = false;
});

it('ends with integrations and AI', async () => {
  render(withRouter(<LimitsPage />));
  const budgets = await screen.findByText('Budgets section');
  const integrations = screen.getByText('Integrations section');
  expect(
    budgets.compareDocumentPosition(integrations) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
});
