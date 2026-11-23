import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { findDoc } from '@/lib/docs-manifest';
import { FeatureExplorer } from './feature-explorer';

function renderFeatures() {
  return render(withRouter(<FeatureExplorer />));
}

describe('feature explorer', () => {
  it('starts with hosting and a matching source-deployment guide', async () => {
    renderFeatures();
    const region = await screen.findByRole('region', {
      name: /explore the pieces of your backend/i,
    });
    expect(region).toHaveAttribute('id', 'why');
    expect(within(region).getByRole('tab', { name: /hosting/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(within(region).getByRole('tab', { name: 'Source deploys' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const detail = within(region).getByRole('tabpanel', { name: 'Source deploys' });
    // Available hosting features need no qualification label.
    expect(detail.querySelector('.feature-availability')).toBeNull();
    expect(within(detail).getByRole('link', { name: /read the guide/i })).toHaveAttribute(
      'href',
      '/docs/deploy-from-github'
    );
  });

  it('changes the explanation and guide when a feature is clicked', async () => {
    const user = userEvent.setup();
    renderFeatures();
    const scale = await screen.findByRole('tab', { name: 'Scale to zero' });
    await user.click(scale);
    expect(scale).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Source deploys' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    const detail = screen.getByRole('tabpanel', { name: 'Scale to zero' });
    expect(detail).toHaveTextContent(/first request waits/i);
    expect(within(detail).getByRole('link', { name: /read the guide/i })).toHaveAttribute(
      'href',
      '/docs/scale-to-zero'
    );
  });

  it.each([
    ['PR previews', null, '/docs/preview-environments', /separate allowance/],
    [
      'Object storage',
      'Preview',
      '/docs/object-storage',
      /availability depends on the storage rollout/,
    ],
  ] as const)(
    'explains %s availability, and links to the published guide',
    async (name, status, href, qualification) => {
      const user = userEvent.setup();
      renderFeatures();
      await user.click(await screen.findByRole('tab', { name }));
      const panel = screen.getByRole('tabpanel', { name });
      if (status) expect(within(panel).getByText(status)).toBeInTheDocument();
      else expect(panel.querySelector('.feature-availability')).toBeNull();
      expect(panel).toHaveTextContent(qualification);
      const guide = within(panel).queryByRole('link', { name: /read the guide/i });
      if (href) expect(guide).toHaveAttribute('href', href);
      else expect(guide).toBeNull();
    }
  );

  it('resets selection when switching categories and qualifies unfinished capabilities', async () => {
    const user = userEvent.setup();
    renderFeatures();
    await user.click(await screen.findByRole('tab', { name: 'Custom domains' }));
    await user.click(screen.getByRole('tab', { name: /connected work/i }));
    expect(screen.queryByRole('tab', { name: 'Custom domains' })).not.toBeInTheDocument();
    const services = screen.getByRole('tabpanel', { name: 'Service connections' });
    expect(services.querySelector('.feature-availability')).toBeNull();
    expect(within(services).getByRole('link', { name: 'Read the guide' })).toHaveAttribute(
      'href',
      '/docs/internal-services'
    );
    for (const name of ['Background jobs', 'Workflows']) {
      await user.click(screen.getByRole('tab', { name }));
      expect(within(screen.getByRole('tabpanel', { name })).getByText('Beta')).toBeInTheDocument();
    }
    expect(within(services).queryByText(/coming soon/i)).not.toBeInTheDocument();
    expect(
      within(services).queryByRole('link', { name: /read platform docs/i })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Release coordination' }));
    const release = screen.getByRole('tabpanel', { name: 'Release coordination' });
    expect(within(release).getByText('In development')).toBeInTheDocument();
    expect(within(release).queryByText(/coming soon/i)).not.toBeInTheDocument();
    expect(
      within(release).queryByRole('link', { name: /read platform docs/i })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /hosting/i }));
    expect(screen.getByRole('tab', { name: 'Source deploys' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('supports arrow, Home, and End navigation with focus following selection', async () => {
    const user = userEvent.setup();
    renderFeatures();
    const source = await screen.findByRole('tab', { name: 'Source deploys' });
    source.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Scale to zero' })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Scale to zero' })).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Object storage' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('tab', { name: 'Secrets & config' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Object storage' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(source).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Object storage' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(source).toHaveFocus();
    const hosting = screen.getByRole('tab', { name: /hosting/i });
    hosting.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /connected work/i })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Service connections' })).toBeInTheDocument();
  });

  it('connects every selector to the visible panel and only exposes the current description', async () => {
    const user = userEvent.setup();
    renderFeatures();
    await screen.findByRole('tab', { name: 'Source deploys' });
    for (const group of [/hosting/i, /connected work/i]) {
      await user.click(screen.getByRole('tab', { name: group }));
      const list = screen.getByRole('tablist', { name: 'Features' });
      for (const tab of within(list).getAllByRole('tab')) {
        await user.click(tab);
        const panel = document.getElementById(tab.getAttribute('aria-controls')!);
        expect(panel).toHaveAttribute('role', 'tabpanel');
        expect(panel).toHaveAttribute('aria-labelledby', tab.id);
        expect(within(list).getAllByRole('tab', { selected: true })).toHaveLength(1);
        expect(within(panel!).getAllByRole('heading', { level: 3 })).toHaveLength(1);
      }
    }
  });

  it.each([
    ['Service connections', '/docs/internal-services', 'payments.internal'],
    ['Background jobs', '/docs/jobs', 'Attempt 2'],
    ['Workflows', '/docs/code-workflows', 'Callback'],
    ['Release coordination', '/docs/service-release-graphs', 'Dependency check'],
  ])('draws %s and links to its guide', async (name, href, figureText) => {
    const user = userEvent.setup();
    renderFeatures();
    await user.click(await screen.findByRole('tab', { name: /connected work/i }));
    await user.click(screen.getByRole('tab', { name }));
    const panel = screen.getByRole('tabpanel', { name });
    expect(panel.querySelector('svg.hosting-diagram')).toHaveTextContent(figureText);
    expect(within(panel).getByRole('link', { name: /read the guide/i })).toHaveAttribute(
      'href',
      href
    );
  });

  it('links every guide to a published doc page', async () => {
    const user = userEvent.setup();
    renderFeatures();
    await screen.findByRole('tab', { name: 'Source deploys' });
    const slugs: string[] = [];
    for (const group of [/hosting/i, /connected work/i]) {
      await user.click(screen.getByRole('tab', { name: group }));
      const list = screen.getByRole('tablist', { name: 'Features' });
      for (const tab of within(list).getAllByRole('tab')) {
        await user.click(tab);
        const link = screen.queryByRole('link', { name: /read the guide/i });
        if (link) slugs.push(link.getAttribute('href')!.replace('/docs/', ''));
      }
    }
    expect(slugs).toContain('secrets');
    for (const slug of slugs) expect(findDoc(slug), slug).toBeDefined();
  });
});
