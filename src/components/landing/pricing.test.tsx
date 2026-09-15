import { GlimmProvider } from 'glimm/react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { PLAN_CATALOG, formatPlanPrice } from '@/lib/plan-catalog';
import { Pricing } from './pricing';

describe('beta pricing', () => {
  it('publishes the generated catalog with billing explicitly disabled and no checkout controls', async () => {
    render(
      withRouter(
        <GlimmProvider palette="lagoon">
          <Pricing />
        </GlimmProvider>
      )
    );
    const pricing = await screen.findByRole('region', { name: 'Plans and pricing' });
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
    for (const plan of PLAN_CATALOG.plans) {
      const card = within(pricing).getByRole('article', { name: plan.name });
      expect(card).toHaveTextContent(formatPlanPrice(plan.monthly));
      for (const [label, value] of Object.entries({
        'Deployed apps': plan.deployedApps,
        'Developer apps': plan.developerApps,
        'Concurrent instances / app': plan.concurrentInstances,
        'RAM / app': `${plan.ramMb} MB`,
        'Included GB-RAM-hours': plan.includedGbHours,
        'App layer': `${plan.appLayerMb} MB`,
        'Idle timeout': plan.idleTimeout,
      })) {
        expect(within(card).getByText(label).nextElementSibling).toHaveTextContent(String(value));
      }
    }
    expect(
      within(pricing).getByRole('link', { name: 'Plan limits and billing details' })
    ).toHaveAttribute('href', '/docs/plans');
  });
});
