import { render, screen } from '@testing-library/react';
import { GlimmProvider } from 'glimm/react';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { RESTORE_CONTEXT, RESTORE_DOC_SLUG, RESTORE_TARGET } from '@/lib/platform-claims';
import { Hero } from './hero';

const PALETTE = 'lagoon';

function renderHero() {
  return render(
    withRouter(
      <GlimmProvider palette={PALETTE}>
        <Hero />
      </GlimmProvider>
    )
  );
}

/**
 * The headline, the primary action and the install command are the page's
 * message; the light behind them must stay decorative to assistive tech.
 *
 * The wake figure is the page's one load-bearing number, and it is a
 * platform-only p95 *target* rather than a measured end-to-end serving
 * time (docs/STATUS.md still lists the §14 V2 latency driver as open).
 * The last two tests are the guard: it may appear once, as the sanctioned
 * claim string, with its measurement boundary next to it.
 */
describe('Hero', () => {
  it('leads with the always-deployed, never-always-on line', async () => {
    renderHero();
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Always deployed. Never always-on.');
  });

  it('keeps the primary action and the install command as real controls', async () => {
    renderHero();
    const cta = await screen.findByRole('link', { name: /join the beta/i });
    expect(cta).toHaveAttribute('href', '/signup');
    expect(
      screen.getByRole('button', { name: 'Copy install command: npm install -g gregale' })
    ).toBeInTheDocument();
  });

  it('states the wake figure as the sanctioned claim, linked to its docs page', async () => {
    renderHero();
    await screen.findByRole('heading', { level: 1 });
    const claim = await screen.findByRole('link', { name: RESTORE_TARGET });
    expect(claim).toHaveAttribute('href', `/docs/${RESTORE_DOC_SLUG}`);
    expect(screen.getByText(RESTORE_CONTEXT)).toBeInTheDocument();
  });

  it('never restates the wake figure outside that claim', async () => {
    renderHero();
    await screen.findByRole('heading', { level: 1 });
    const claim = await screen.findByRole('link', { name: RESTORE_TARGET });
    const outside = (document.body.textContent ?? '').replace(claim.textContent ?? '', '');
    expect(outside).not.toMatch(/350\s*ms/);
  });

  it('hides the light field from assistive tech', async () => {
    renderHero();
    await screen.findByRole('heading', { level: 1 });
    const field = document.querySelector('[data-beam-field]');
    expect(field).not.toBeNull();
    expect(field).toHaveAttribute('aria-hidden', 'true');
  });
});
