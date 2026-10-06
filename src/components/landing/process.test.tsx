import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { Process, STEPS } from './process';
import { DeploymentPreview, TracePreview, WakeSourcesPreview } from './product-previews';

/** The existing hover/focus accordion now walks through a first deployment. */
describe('Process', () => {
  it('shows an ordered deployment walkthrough with the first step open', async () => {
    render(withRouter(<Process />));
    const cards = await screen.findAllByRole('button', { expanded: undefined });
    expect(cards).toHaveLength(3);
    expect(
      screen.getByRole('heading', { name: 'From repository to running API.' })
    ).toBeInTheDocument();
    expect(cards.map((card) => within(card).getByRole('heading').textContent)).toEqual([
      'Bring your repository.',
      'Set your configuration.',
      'Deploy and verify.',
    ]);
    expect(cards[0]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(STEPS[0].body)).toBeInTheDocument();
  });

  it('opens the card under the pointer and keeps it open after leaving', async () => {
    const user = userEvent.setup();
    render(withRouter(<Process />));
    const cards = await screen.findAllByRole('button');
    await user.hover(cards[2]);
    await waitFor(() => expect(cards[2]).toHaveAttribute('aria-expanded', 'true'));
    await user.unhover(cards[2]);
    expect(cards[2]).toHaveAttribute('aria-expanded', 'true');
    expect(cards[0]).toHaveAttribute('aria-expanded', 'false');
  });

  it('links beta hosting capabilities to their published guides', async () => {
    render(withRouter(<Process />));
    await screen.findAllByRole('button');
    // jsdom reports no `min-width` match, so every card renders open here.
    const hrefs = new Set(screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? ''));
    for (const slug of ['deploy-from-source', 'storage', 'runtime-node']) {
      expect(hrefs).toContain(`/docs/${slug}`);
    }
  });
});

describe('product previews', () => {
  const panelFor = (title: string) =>
    title === 'Deploy' ? (
      <DeploymentPreview />
    ) : title === 'Park & wake' ? (
      <WakeSourcesPreview />
    ) : (
      <TracePreview requests />
    );

  it.each(['Deploy', 'Park & wake', 'Observe'])(
    'identifies the %s preview as illustrative rather than live account data',
    (title) => {
      render(panelFor(title));
      expect(screen.getByRole('figure', { name: /example/i })).toBeInTheDocument();
    }
  );

  it('makes the request status and duration understandable without column alignment', () => {
    render(panelFor('Observe'));
    const requests = screen.getByRole('table', { name: /requests/i });
    expect(within(requests).getByRole('columnheader', { name: /status/i })).toBeInTheDocument();
    expect(within(requests).getByRole('columnheader', { name: /duration/i })).toBeInTheDocument();
    const request = within(requests).getByRole('row', { name: /hello.*GET.*200.*340 ms/i });
    expect(within(request).getAllByRole('cell')).toHaveLength(3);
  });

  it('explains the timing graphic without relying on mint shades', () => {
    render(panelFor('Observe'));
    expect(
      screen.getByRole('img', { name: /restore.*214 ms.*other.*126 ms.*total.*340 ms/i })
    ).toBeInTheDocument();
  });
});
