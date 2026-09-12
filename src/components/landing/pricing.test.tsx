import { render, screen, within } from '@testing-library/react';
import { GlimmProvider } from 'glimm/react';
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
  it('offers beta signup instead of purchasable plans at the pricing anchor', async () => {
    renderPricing();
    const pricing = await screen.findByRole('region', { name: /pricing coming soon/i });
    expect(pricing).toHaveAttribute('id', 'pricing');
    expect(within(pricing).getByRole('link', { name: /join the beta/i })).toHaveAttribute(
      'href',
      '/signup'
    );
    expect(within(pricing).getAllByRole('link')).toHaveLength(1);
    expect(within(pricing).queryByRole('button')).not.toBeInTheDocument();
  });

  it('makes obscured prices and plan controls inert and hidden from assistive technology', async () => {
    renderPricing();
    const plan = await screen.findByText('Select Hobby');
    const preview = plan.closest('[inert]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('link', { name: 'Select Hobby' })).not.toBeInTheDocument();
  });
});
