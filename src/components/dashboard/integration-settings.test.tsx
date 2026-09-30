import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntegrationSettings } from './integration-settings';

const mocks = vi.hoisted(() => ({ issueCSRF: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ issueCSRF: mocks.issueCSRF }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { github_install_id: '' }, apiReachable: true }),
  consumeOnboardingGitHubReturn: () => false,
}));
afterEach(() => vi.restoreAllMocks());

describe('IntegrationSettings GitHub connection', () => {
  it('submits the named action proof from the settings button', async () => {
    mocks.issueCSRF.mockResolvedValue('settings-proof');
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
      this: HTMLFormElement
    ) {
      expect(new FormData(this).get('csrf_token')).toBe('settings-proof');
    });
    render(<IntegrationSettings search={{ section: 'integrations' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(mocks.issueCSRF).toHaveBeenCalledWith('connect_github');
  });

  it('explains a rejected connection after the backend redirects back', () => {
    render(
      <IntegrationSettings search={{ section: 'integrations', github: 'connect-forbidden' }} />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('GitHub connection was rejected.');
    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeEnabled();
  });
});
