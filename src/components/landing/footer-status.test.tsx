import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { withRouter } from '@/test/router';
import { FooterStatusLink } from './footer-status';

const viewport = vi.hoisted(() => ({ visible: true }));
vi.mock('motion/react', () => ({ useInView: () => viewport.visible }));

afterEach(() => {
  viewport.visible = true;
  vi.restoreAllMocks();
});

function renderStatus() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      {withRouter(<FooterStatusLink className="">System status</FooterStatusLink>)}
    </QueryClientProvider>
  );
}

it.each([
  ['fresh', 'operational', 'All systems operational'],
  ['fresh', 'partial_outage', 'Partial outage'],
  ['stale', 'operational', 'Updates delayed'],
  ['unavailable', 'operational', 'Status unavailable'],
])('shows the %s %s snapshot as %s', async (dataStatus, state, label) => {
  const get = spyApi('GET').mockResolvedValue({
    response: new Response(),
    data: { data_status: dataStatus, overall_status: state },
  });

  renderStatus();

  expect(
    await screen.findByRole('link', { name: 'System status', description: label })
  ).toHaveAttribute('href', '/status');
  expect(get).toHaveBeenCalledWith('/v1/status', {});
});

it('keeps the status page reachable if the API request fails', async () => {
  spyApi('GET').mockRejectedValue(new Error('Unavailable'));
  renderStatus();
  expect(
    await screen.findByRole('link', { name: 'System status', description: 'Status unavailable' })
  ).toHaveAttribute('href', '/status');
});

it('defers the status request while the footer link is out of view', async () => {
  viewport.visible = false;
  const get = spyApi('GET');
  renderStatus();
  await screen.findByRole('link', { name: 'System status', description: 'Checking status' });
  expect(get).not.toHaveBeenCalled();
});
