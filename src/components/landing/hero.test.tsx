import { render, screen } from '@testing-library/react';
import { GlimmProvider } from 'glimm/react';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
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
 */
describe('Hero', () => {
  it('keeps the landing headline, with the wake time as the accent', async () => {
    renderHero();
    const h1 = await screen.findByRole('heading', { level: 1 });
    // The accent rotates, but the accessible name does not: the rotating
    // spans are aria-hidden, so a screen reader gets one stable sentence
    // rather than all six phrases concatenated.
    expect(h1).toHaveAccessibleName(
      'Serverless on real microVMs. Scale to zero. Wake in under 350 ms.'
    );
  });

  it('shows the first phrase, so the headline is never blank', async () => {
    renderHero();
    const h1 = await screen.findByRole('heading', { level: 1 });
    // DiaText renders one phrase at a time and rotates; the first is what a
    // reader sees before any rotation has happened.
    expect(h1).toHaveTextContent('Wake in under 350 ms.');
  });

  it('keeps the primary action and the install command as real controls', async () => {
    renderHero();
    const cta = await screen.findByRole('link', { name: /start deploying/i });
    expect(cta).toHaveAttribute('href', '/signup');
    expect(
      screen.getByRole('button', { name: 'Copy install command: brew install gregale' })
    ).toBeInTheDocument();
  });

  it('hides the light field from assistive tech', async () => {
    renderHero();
    await screen.findByRole('heading', { level: 1 });
    const field = document.querySelector('[data-beam-field]');
    expect(field).not.toBeNull();
    expect(field).toHaveAttribute('aria-hidden', 'true');
  });
});
