import { GlimmProvider } from 'glimm/react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { Pricing } from './pricing';

function renderPricing() {
  return render(
    withRouter(
      <GlimmProvider palette="lagoon">
        <Pricing />
      </GlimmProvider>
    )
  );
}

describe('pricing', () => {
  it('links signup, console plans and the billing guide', async () => {
    renderPricing();
    const pricing = await screen.findByRole('region', { name: 'Plans and pricing' });
    expect(pricing).toHaveAttribute('id', 'pricing');
    const links = within(pricing);
    expect(links.getByRole('link', { name: 'Start free' })).toHaveAttribute('href', '/signup');
    expect(links.getByRole('link', { name: 'View plans in console' })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
    expect(links.getByRole('link', { name: 'Plan limits and billing details' })).toHaveAttribute(
      'href',
      '/docs/plans'
    );
    expect(pricing).toHaveTextContent(/prices are in USD per month before tax/i);
    expect(pricing).toHaveTextContent('$0.05 per GB-RAM-hour');
  });

  it('shows catalog prices and all nine plan limits in the accessibility tree', async () => {
    renderPricing();
    const pricing = await screen.findByRole('region', { name: 'Plans and pricing' });
    const cards = within(pricing).getAllByRole('article');
    const labels = [
      'Deployed apps',
      'PR preview environments',
      'Developer apps',
      'Concurrent instances / app',
      'RAM / app',
      'Included GB-RAM-hours',
      'App layer',
      'Idle timeout',
      'Max request timeout',
    ];
    const expected = [
      {
        name: 'Free',
        price: '$0',
        limits: ['1', '1', '1', '1', '256 MB', '20', '256 MB', '1m', '30s'],
      },
      {
        name: 'Hobby',
        price: '$10',
        limits: ['5', '2', '2', '2', '512 MB', '200', '512 MB', '1m', '1m'],
      },
      {
        name: 'Pro',
        price: '$30',
        limits: ['25', '5', '5', '5', '1024 MB', '1000', '1024 MB', '5m', '5m'],
      },
      {
        name: 'Scale',
        price: '$99',
        limits: ['100', '20', '10', '20', '2048 MB', '3000', '2048 MB', '10m', '15m'],
      },
    ];
    expect(cards).toHaveLength(4);
    expected.forEach((plan, index) => {
      const card = cards[index];
      expect(card).toHaveAttribute('aria-label', plan.name);
      expect(within(card).getByText(plan.price)).toBeInTheDocument();
      labels.forEach((label, limitIndex) => {
        expect(within(card).getByText(label).nextElementSibling?.textContent).toBe(
          plan.limits[limitIndex]
        );
      });
    });
    expect(pricing).toHaveTextContent('$0.05 per GB-RAM-hour');
    expect(pricing).not.toHaveTextContent(/1M invocations|€|US\$|Enterprise/);
  });
});
