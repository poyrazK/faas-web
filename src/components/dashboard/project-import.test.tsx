import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectImport } from './project-import';
import type { ReactNode } from 'react';
const scan = vi.hoisted(() => vi.fn());
const apply = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/queries', () => ({
  useProjectScan: () => ({ mutateAsync: scan, isPending: false }),
  useProjectApply: () => ({ mutateAsync: apply, isPending: false }),
}));
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a
      href={to
        .replace('$projectSlug', params?.projectSlug ?? '')
        .replace('$workflowId', params?.workflowId ?? '')}
    >
      {children}
    </a>
  ),
}));
afterEach(() => vi.clearAllMocks());
it('links the applied project using the reviewed server plan identity', async () => {
  scan.mockResolvedValue({
    project_slug: 'shop',
    plan_token: 'token',
    scan_source: 'compose',
    can_apply: true,
    workloads: [],
    managed: [],
    crons: [],
    quota: {},
  });
  apply.mockResolvedValue({ project_id: 'project-1', apps: [] });
  const { container } = render(<ProjectImport />);
  const input = container.querySelector('input[type=file]') as HTMLInputElement;
  await userEvent.upload(input, new File(['archive'], 'repo.tar.gz', { type: 'application/gzip' }));
  await userEvent.click(screen.getByRole('button', { name: 'Scan' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Apply plan' }));
  expect(await screen.findByRole('link', { name: 'View project shop' })).toHaveAttribute(
    'href',
    '/dashboard/projects/shop'
  );
});
