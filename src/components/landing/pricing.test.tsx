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

describe('beta pricing', () => {
  it('offers signup and billing details rather than purchasable plans', async () => {
    renderPricing();
    const pricing = await screen.findByRole('region', { name: /pricing coming soon/i });
    expect(pricing).toHaveAttribute('id', 'pricing');
    expect(
      within(pricing).getByText(/paid billing and checkout are disabled during beta/i)
    ).toBeInTheDocument();
    expect(within(pricing).getByRole('link', { name: 'Join the beta' })).toHaveAttribute(
      'href',
      '/signup'
    );
    expect(
      within(pricing).queryByRole('link', { name: /select|buy|upgrade/i })
    ).not.toBeInTheDocument();
    expect(pricing).not.toHaveTextContent(/1M invocations|\$|Enterprise/);
    expect(within(pricing).queryByRole('article')).not.toBeInTheDocument();
    expect(within(pricing).queryByRole('button')).not.toBeInTheDocument();
    expect(within(pricing).getAllByRole('link')).toHaveLength(2);
    expect(
      within(pricing).getByRole('link', { name: 'Plan limits and billing details' })
    ).toHaveAttribute('href', '/docs/plans');
  });

  it('keeps the obscured plan catalog inert and out of the accessibility tree', async () => {
    renderPricing();
    const pricing = await screen.findByRole('region', { name: /pricing coming soon/i });
    const preview = within(pricing).getByText('Hobby').closest('[inert]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(preview?.querySelector('a')).toBeNull();
    expect(within(pricing).queryByRole('article', { name: 'Hobby' })).not.toBeInTheDocument();
  });

  it('preserves the generated euro prices and all seven plan limits beneath the blur', async () => {
    renderPricing();
    const pricing = await screen.findByRole('region', { name: /pricing coming soon/i });
    const cards = within(pricing).getAllByRole('article', { hidden: true });
    const labels = [
      'Deployed apps',
      'Developer apps',
      'Concurrent instances / app',
      'RAM / app',
      'Included GB-RAM-hours',
      'App layer',
      'Idle timeout',
    ];
    const expected = [
      { name: 'Free', price: '€0', limits: ['1', '1', '1', '128 MB', '5', '256 MB', '1m'] },
      { name: 'Hobby', price: '€9', limits: ['5', '2', '2', '256 MB', '50', '512 MB', '1m'] },
      { name: 'Pro', price: '€29', limits: ['25', '5', '5', '512 MB', '250', '1024 MB', '5m'] },
      {
        name: 'Scale',
        price: '€99',
        limits: ['100', '10', '20', '1024 MB', '1500', '2048 MB', '10m'],
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
    expect(pricing).not.toHaveTextContent(/1M invocations|\$|Enterprise/);
  });
});
