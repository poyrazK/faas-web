import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { Process } from './process';
import { DeploymentPreview, TracePreview, WakeSourcesPreview } from './product-previews';

describe('Process', () => {
  it('shows the deploy flow under its heading, with a plain-text summary', async () => {
    render(withRouter(<Process />));
    expect(
      await screen.findByRole('heading', { name: 'From repository to running API.' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Gregale fetches the code, detects the runtime/)).toBeInTheDocument();
    expect(screen.getByText('Example data')).toBeInTheDocument();
  });

  it('links hosting capabilities to their published guides', async () => {
    render(withRouter(<Process />));
    const nav = await screen.findByRole('navigation', { name: 'Deploy guides' });
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    for (const slug of [
      'deploy-from-source',
      'deploy-from-github',
      'storage',
      'runtime-node',
      'agents',
    ])
      expect(hrefs).toContain(`/docs/${slug}`);
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
