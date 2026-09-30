import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubConnect } from './github-connect';

const issueCSRF = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ issueCSRF }));

describe('GitHubConnect', () => {
  beforeEach(() => {
    issueCSRF.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('waits for a fresh proof, then navigates with a native form POST', async () => {
    let resolveToken!: (token: string) => void;
    issueCSRF.mockReturnValue(new Promise<string>((resolve) => (resolveToken = resolve)));
    const onConnect = vi.fn();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
      this: HTMLFormElement
    ) {
      expect(this.method).toBe('post');
      expect(this.getAttribute('action')).toBe('/dashboard/install/connect');
      expect(new FormData(this).get('csrf_token')).toBe('fresh-connect-proof');
      expect(onConnect).toHaveBeenCalledOnce();
    });
    render(<GitHubConnect onConnect={onConnect} />);
    const form = screen.getByRole('button', { name: 'Connect GitHub' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(issueCSRF).toHaveBeenCalledExactlyOnceWith('connect_github');
    expect(submit).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
    await act(async () => resolveToken('fresh-connect-proof'));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('shows issuance failures without navigating and obtains a new token on retry', async () => {
    issueCSRF.mockRejectedValueOnce(new Error('Could not reach the API.'));
    issueCSRF.mockResolvedValueOnce('retry-proof');
    const onConnect = vi.fn();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    render(<GitHubConnect onConnect={onConnect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the API.');
    expect(submit).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(issueCSRF).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not issue a token while disabled', () => {
    render(<GitHubConnect disabled />);
    fireEvent.submit(screen.getByRole('button', { name: 'Connect GitHub' }).closest('form')!);
    expect(issueCSRF).not.toHaveBeenCalled();
  });

  it('does not start a connection after its form is unmounted', async () => {
    let resolveToken!: (token: string) => void;
    issueCSRF.mockReturnValue(new Promise<string>((resolve) => (resolveToken = resolve)));
    const onConnect = vi.fn();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    const { unmount } = render(<GitHubConnect onConnect={onConnect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    unmount();
    await act(async () => resolveToken('proof'));
    expect(submit).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });
});
