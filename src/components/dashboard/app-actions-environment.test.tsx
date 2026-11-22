import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Workflow } from '@/lib/mock-data';

const env = vi.hoisted(() => ({ applies: true, environment: 'staging', name: 'Staging' }));
vi.mock('@/lib/environment-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/environment-scope')>()),
  useEnvironmentScope: () => ({
    ...env,
    kind: 'stage',
    choices: null,
    available: true,
    list: { isPending: false, isError: false, refetch: () => undefined },
  }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/store', () => ({ useData: () => ({ redeploy: vi.fn() }) }));

const { RollbackButton, DeployLabel } = await import('./app-actions-menu');
const { EnvironmentBannerProvider } = await import('./production-only-banner');

const app = { id: 'api', name: 'api' } as Workflow;
const inShell = (ui: React.ReactNode) =>
  render(<EnvironmentBannerProvider>{ui}</EnvironmentBannerProvider>);
afterEach(() => Object.assign(env, { applies: true, environment: 'staging', name: 'Staging' }));

it('in Staging, Roll back and Deploy name production', () => {
  inShell(
    <>
      <RollbackButton app={app} target={null} isDeploying={false} />
      <DeployLabel deploying={false} />
    </>
  );
  expect(screen.getByRole('button', { name: /Roll back production/ })).toBeInTheDocument();
  expect(screen.getByText('Deploy to production')).toBeInTheDocument();
});

it('in production they read as before', () => {
  Object.assign(env, { environment: 'production', name: 'Production' });
  inShell(
    <>
      <RollbackButton app={app} target={null} isDeploying={false} />
      <DeployLabel deploying={false} />
    </>
  );
  expect(screen.getByRole('button', { name: 'Roll back' })).toBeInTheDocument();
  expect(screen.getByText('Deploy')).toBeInTheDocument();
});
