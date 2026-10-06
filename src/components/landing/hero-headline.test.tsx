import { act, render, screen } from '@testing-library/react';
import { GlimmProvider } from 'glimm/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { Hero } from './hero';

async function mount() {
  render(
    withRouter(
      <GlimmProvider palette="lagoon">
        <Hero />
      </GlimmProvider>
    )
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 20) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(20, ms - elapsed));
    });
  }
}
const phraseText = () => screen.getByTestId('hero-capability').textContent;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('hero capability loop', () => {
  it('cycles all eight capabilities and returns to the first without a status strip', async () => {
    await mount();
    const phrases = [
      ['APIs that wake on demand.', 'Public beta'],
      ['services that work together.', 'Preview'],
      ['background jobs that retry.', 'Preview'],
      ['workflows that wait and resume.', 'Preview'],
      ['webhooks that wake your app.', 'Preview'],
      ['MCP servers for your agents.', 'Preview'],
      ['previews before you merge.', 'Public beta'],
      ['code runs in isolated microVMs.', 'Preview'],
      ['APIs that wake on demand.', 'Public beta'],
    ];
    for (const [index, [text]] of phrases.entries()) {
      if (index > 0) await advance(5200);
      expect(phraseText()).toBe(text);
    }
    expect(screen.queryByTestId('hero-capability-availability')).not.toBeInTheDocument();
    expect(screen.queryByText(/01 \/ 08/)).not.toBeInTheDocument();
  });

  it('keeps a stable accessible heading while the visible phrase changes', async () => {
    await mount();
    await advance(3200);
    expect(phraseText()).toBe('APIs that wake on demand.');
    await advance(2000);
    expect(phraseText()).toBe('services that work together.');
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(
      /Next-generation cloud for APIs, services/
    );
  });

  it('lets a visitor pause on a complete phrase and resume the loop', async () => {
    await mount();
    await advance(5350);
    act(() => screen.getByRole('button', { name: 'Pause headline animation' }).click());
    const phrase = screen.getByTestId('hero-capability');
    expect(phrase).toHaveTextContent('services that work together.');
    await advance(7000);
    expect(phrase).toHaveTextContent('services that work together.');
    act(() => screen.getByRole('button', { name: 'Resume headline animation' }).click());
    await advance(5200);
    expect(screen.getByTestId('hero-capability')).toHaveTextContent('background jobs that retry.');
  });

  it('stops the reveal loop when the document is hidden and resumes when visible', async () => {
    await mount();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await advance(7000);
    expect(screen.getByTestId('hero-capability')).toHaveTextContent('APIs that wake on demand.');
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await advance(5200);
    expect(screen.getByTestId('hero-capability')).toHaveTextContent('services that work together.');
  });

  it('shows a complete static headline when reduced motion is requested', async () => {
    const original = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...original(query),
      matches: query === '(prefers-reduced-motion: reduce)',
    }));
    await mount();
    await advance(7000);
    expect(screen.getByTestId('hero-capability')).toHaveTextContent('APIs that wake on demand.');
    expect(screen.queryByRole('button', { name: /headline animation/ })).not.toBeInTheDocument();
  });
});
