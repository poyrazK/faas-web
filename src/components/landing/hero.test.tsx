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

  it('renders every rotating phrase, with the first one the one that paints', async () => {
    renderHero();
    await screen.findByRole('heading', { level: 1 });
    // All six are in the DOM so the CSS loop needs no JS; the stack sizes
    // itself to the longest, so the balanced h1 cannot reflow as they cycle.
    const phrases = document.querySelectorAll('.hero-phrase');
    expect(phrases).toHaveLength(6);
    expect(phrases[0]).toHaveTextContent('Wake in under 350 ms.');
    expect(phrases[0]).not.toHaveClass('opacity-0');
  });

  it('staggers each phrase by one slot', async () => {
    renderHero();
    await screen.findByRole('heading', { level: 1 });
    const phrases = [...document.querySelectorAll<HTMLElement>('.hero-phrase')];
    expect(phrases.map((p) => p.style.animationDelay)).toEqual([
      'calc(0 * var(--hero-phrase-slot))',
      'calc(1 * var(--hero-phrase-slot))',
      'calc(2 * var(--hero-phrase-slot))',
      'calc(3 * var(--hero-phrase-slot))',
      'calc(4 * var(--hero-phrase-slot))',
      'calc(5 * var(--hero-phrase-slot))',
    ]);
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
