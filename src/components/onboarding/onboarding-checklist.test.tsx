import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { readOnboarding, writeOnboarding } from '@/lib/onboarding-draft';
import { OnboardingChecklist } from './onboarding-checklist';
const owner = { account: 'actor', workspace: null };
const deployment = 'a'.repeat(32);
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    account: { id: 'actor', email: 'a@example.test' },
    user: { email: 'a@example.test' },
  }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({
  useWorkspaceTarget: () => ({ org: null, ready: true }),
}));
vi.mock('@/lib/api/onboarding', () => ({
  useOnboardingInventory: () => ({
    apps: [{ id: 'app', slug: 'hello' }],
    deployments: [{ id: 'a'.repeat(32), app_id: 'app', status: 'live' }],
    pending: false,
    error: null,
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
beforeEach(() => {
  localStorage.clear();
  writeOnboarding({
    version: 1,
    owner,
    dismissed: false,
    draft: { kind: 'existing', app: 'hello', deployment, phase: 'accepted' },
  });
});
it('keeps response verification available after a deployment becomes ready', () => {
  render(<OnboardingChecklist />);
  expect(screen.getByRole('heading', { name: 'Verify your app response' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Verify response' })).toHaveAttribute(
    'href',
    '/onboarding'
  );
  expect(screen.queryByText('Application response verified')).not.toBeInTheDocument();
});
it('lets the customer dismiss setup without recording a verification claim', async () => {
  render(<OnboardingChecklist />);
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss setup' }));
  expect(screen.queryByRole('link', { name: 'Verify response' })).not.toBeInTheDocument();
  expect(readOnboarding(owner).dismissed).toBe(true);
});
