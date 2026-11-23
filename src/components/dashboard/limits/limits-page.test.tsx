import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { LimitsPage } from './limits-page';

vi.mock('./use-bill-facts', () => ({ useBillFacts: () => ({ settled: false }) }));
vi.mock('./status-strip', () => ({ StatusStrip: () => <p>Strip</p> }));
vi.mock('./your-bill', () => ({ YourBill: () => <p>Your bill section</p> }));
vi.mock('../capability-gate', () => ({
  CapabilityGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../budgets/budgets-page', () => ({ BudgetsSection: () => <p>Budgets section</p> }));

it('answers first, then Your bill, then budgets', async () => {
  render(withRouter(<LimitsPage />));
  expect(await screen.findByRole('heading', { name: 'Spending limits' })).toBeInTheDocument();
  const [strip, bill, budgets] = ['Strip', 'Your bill section', 'Budgets section'].map((text) =>
    screen.getByText(text)
  );
  expect(strip.compareDocumentPosition(bill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(bill.compareDocumentPosition(budgets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
