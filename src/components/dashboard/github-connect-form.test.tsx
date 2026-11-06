import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubConnectForm } from './github-connect-form';
import { IntegrationSettings } from './integration-settings';

vi.mock('./github-accounts', () => ({ GitHubAccounts: () => null }));

const issueCSRF = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({
  account: {} as { github_install_id?: string },
  apiReachable: true,
}));
vi.mock('@/lib/api/client', () => ({ issueCSRF }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => auth,
  consumeOnboardingGitHubReturn: () => false,
}));

let submissions: { method: string; action: string; body: FormData }[];

beforeEach(() => {
  auth.account = {};
  auth.apiReachable = true;
  submissions = [];
  issueCSRF.mockReset();
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
    this: HTMLFormElement
  ) {
    submissions.push({
      method: this.method,
      action: this.getAttribute('action')!,
      body: new FormData(this),
    });
  });
});

afterEach(() => vi.restoreAllMocks());

describe('GitHub browser connection', () => {
  it('refreshes an existing connection through the account-preserving form with fresh proof', async () => {
    auth.account.github_install_id = '42';
    issueCSRF.mockResolvedValue('refresh-proof');
    render(<IntegrationSettings search={{ section: 'integrations' }} />);

    expect(screen.getByText('Connected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh GitHub connection' }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(issueCSRF).toHaveBeenCalledExactlyOnceWith('connect_github');
    expect(submissions[0].method).toBe('post');
    expect(submissions[0].action).toBe('/dashboard/install/connect');
    expect(Object.fromEntries(submissions[0].body)).toEqual({
      csrf_token: 'refresh-proof',
      return_to: '/dashboard/settings?section=integrations',
    });
  });

  it('waits for fresh proof before navigating and ignores duplicate submits', async () => {
    let resolve!: (token: string) => void;
    issueCSRF.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done;
      })
    );
    const onConnect = vi.fn(() => expect(submissions).toHaveLength(0));
    render(<GitHubConnectForm onConnect={onConnect} />);
    const button = screen.getByRole('button', { name: 'Connect GitHub' });
    const form = button.closest('form')!;

    await userEvent.click(button);
    fireEvent.submit(form);
    expect(issueCSRF).toHaveBeenCalledExactlyOnceWith('connect_github');
    expect(button).toBeDisabled();
    expect(submissions).toHaveLength(0);
    expect(onConnect).not.toHaveBeenCalled();

    await act(async () => resolve('fresh-github-proof'));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(submissions).toHaveLength(1);
    expect(submissions[0].method).toBe('post');
    expect(submissions[0].action).toBe('/dashboard/install/connect');
    expect(Object.fromEntries(submissions[0].body)).toEqual({
      csrf_token: 'fresh-github-proof',
      return_to: '/dashboard/settings?section=integrations',
    });
  });

  it('shows token failures without submitting and lets the user retry', async () => {
    issueCSRF
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce('retry-proof');
    const onConnect = vi.fn();
    render(<GitHubConnectForm onConnect={onConnect} />);

    await userEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the API. Check your connection.'
    );
    expect(submissions).toHaveLength(0);
    expect(onConnect).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(issueCSRF).toHaveBeenCalledTimes(2);
    expect(submissions[0].body.get('csrf_token')).toBe('retry-proof');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('does not submit an empty proof or start a disabled connection', async () => {
    issueCSRF.mockResolvedValue('');
    const view = render(<GitHubConnectForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
    expect(submissions).toHaveLength(0);

    view.rerender(<GitHubConnectForm disabled />);
    fireEvent.submit(screen.getByRole('button', { name: 'Connect GitHub' }).closest('form')!);
    expect(issueCSRF).toHaveBeenCalledTimes(1);
    expect(submissions).toHaveLength(0);
  });

  it('shows the settings callback error and retries with proof', async () => {
    issueCSRF.mockResolvedValue('settings-proof');
    render(
      <IntegrationSettings search={{ github: 'connect-forbidden', section: 'integrations' }} />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The connection request expired or its browser cookie is missing.'
    );

    await userEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0].body.get('csrf_token')).toBe('settings-proof');
  });

  it.each([
    ['github_access_denied', 'GitHub connection cancelled', 'approve repository access'],
    ['csrf_missing', 'GitHub connection expired', 'browser cookie is missing'],
    ['csrf_mismatch', 'GitHub connection could not be verified', 'Close older connection tabs'],
    ['github_unreachable', 'GitHub connection could not finish', 'in a minute'],
    [
      'oauth_provider_unavailable',
      'GitHub connections are temporarily unavailable',
      'contact support',
    ],
    [
      'github_account_conflict',
      'GitHub deployment connection could not be saved',
      'same GitHub account',
    ],
  ])('explains %s and offers a fresh connection', async (code, title, recovery) => {
    issueCSRF.mockResolvedValue('recovery-proof');
    render(
      <IntegrationSettings
        search={{ section: 'integrations', github: 'connect-failed', github_error: code }}
      />
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(title);
    expect(alert).toHaveTextContent(recovery);
    expect(alert).toHaveTextContent(`Error code: ${code}`);
    await userEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0].body.get('csrf_token')).toBe('recovery-proof');
  });

  it('uses safe fallback copy for unknown callback errors', () => {
    render(
      <IntegrationSettings
        search={{
          section: 'integrations',
          github: 'connect-failed',
          github_error: '<script>provider secret</script>',
        }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Start Connect GitHub again.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('provider secret');
    expect(screen.queryByText('Error code:')).not.toBeInTheDocument();
  });
});
