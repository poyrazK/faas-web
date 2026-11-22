import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ applies: true, environment: 'staging', name: 'Staging' }));
vi.mock('@/lib/environment-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/environment-scope')>()),
  useEnvironmentScope: () => ({
    ...env,
    kind: env.environment === 'production' ? 'production' : 'stage',
    choices: null,
    available: true,
    list: { isPending: false, isError: false, refetch: () => undefined },
  }),
}));

const {
  EnvironmentBannerProvider,
  ProductionOnlyBanner: Banner,
  appTabShowsProduction,
  productionNoun,
  withProductionBanner,
} = await import('./production-only-banner');

/** The shell provides the banner's environment; outside it there is none. */
const inShell = (ui: React.ReactNode) =>
  render(<EnvironmentBannerProvider>{ui}</EnvironmentBannerProvider>);
const ProductionOnlyBanner = Banner;

afterEach(() => Object.assign(env, { applies: true, environment: 'staging', name: 'Staging' }));

it('says Staging shows production for this page, and that changes apply there', () => {
  inShell(<ProductionOnlyBanner what="alerts" />);
  expect(screen.getByRole('note')).toHaveTextContent(
    'This shows production. Changes here apply to production; Staging doesn’t have its own alerts yet.'
  );
});

it('says nothing in production', () => {
  Object.assign(env, { environment: 'production', name: 'Production' });
  inShell(<ProductionOnlyBanner what="alerts" />);
  expect(screen.queryByRole('note')).toBeNull();
});

it('says nothing where environments don’t apply', () => {
  env.applies = false;
  inShell(<ProductionOnlyBanner what="alerts" />);
  expect(screen.queryByRole('note')).toBeNull();
});

it('scoped app tabs have no banner; production-only ones do', () => {
  for (const tab of ['Environment', 'Routes', 'Upstreams'])
    expect(appTabShowsProduction(tab)).toBe(false);
  for (const tab of ['Logs', 'Alerts', 'Overview', 'Deployments', 'Webhooks'])
    expect(appTabShowsProduction(tab)).toBe(true);
  expect(productionNoun('Edge rules')).toBe('edge rules');
});

it('withProductionBanner renders the page under the banner', () => {
  const Page = withProductionBanner('releases', () => <p>releases page</p>);
  inShell(<Page />);
  expect(screen.getByRole('note')).toHaveTextContent('own releases yet');
  expect(screen.getByText('releases page')).toBeInTheDocument();
});

it('renders nothing, and needs no router or auth, outside the dashboard shell', () => {
  render(<ProductionOnlyBanner what="alerts" />);
  expect(screen.queryByRole('note')).toBeNull();
});
