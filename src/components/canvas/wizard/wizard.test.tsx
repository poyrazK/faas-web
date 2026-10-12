import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./step-git', () => ({ StepGit: () => <p>git step</p> }));
vi.mock('./step-cli', () => ({ StepCli: () => <p>cli step</p> }));
const account = vi.hoisted(() => ({
  value: { github_install_id: '42' } as Record<string, unknown>,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: account.value }) }));
vi.mock('@/components/dashboard/github-connect-form', () => ({
  GitHubConnectForm: ({ returnTo }: { returnTo: string }) => (
    <button data-return={returnTo}>Connect GitHub</button>
  ),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode;
    to: string;
    params?: { slug?: string };
  }) => <a href={to.replace('$slug', params?.slug ?? '')}>{children}</a>,
}));

const { Wizard } = await import('./wizard');
const base = { apps: [], onLaunched: vi.fn(), onPickExisting: vi.fn(), onCliCreated: vi.fn() };

describe('Wizard', () => {
  it('points newcomers at a docs page that exists', async () => {
    const { findDoc } = await import('@/lib/docs-manifest');
    render(<Wizard {...base} mode="empty" step="start" onStep={vi.fn()} />);
    const href = screen.getByRole('link', { name: /getting started/i }).getAttribute('href');
    expect(href).toBe('/docs/getting-started');
    expect(findDoc('getting-started')).toBeDefined();
  });

  it('opens on one decision for an empty account', () => {
    const onStep = vi.fn();
    render(<Wizard {...base} mode="empty" step="start" onStep={onStep} />);
    expect(screen.getByRole('heading', { name: 'Build your backend' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /deploy an app/i }));
    expect(onStep).toHaveBeenCalledWith('source');
  });

  it('cannot be dismissed on an empty account, but can when there are apps', () => {
    const onStep = vi.fn();
    const { rerender } = render(<Wizard {...base} mode="empty" step="start" onStep={onStep} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onStep).not.toHaveBeenCalled();
    rerender(<Wizard {...base} mode="new" step="start" onStep={onStep} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onStep).toHaveBeenCalledWith(undefined);
  });

  it('esc steps back one step', () => {
    const onStep = vi.fn();
    render(<Wizard {...base} mode="empty" step="source" onStep={onStep} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onStep).toHaveBeenCalledWith('start');
  });

  it('leaves Enter on a focused button to that button', () => {
    const onStep = vi.fn();
    render(<Wizard {...base} mode="empty" step="source" onStep={onStep} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const back = screen.getByRole('button', { name: /Build your backend/ });
    fireEvent.keyDown(back, { key: 'Enter' });
    expect(onStep).not.toHaveBeenCalledWith('git');
    expect(onStep).not.toHaveBeenCalledWith('cli');
  });

  it('chooses a source with the arrow keys and enter', () => {
    const onStep = vi.fn();
    render(<Wizard {...base} mode="empty" step="source" onStep={onStep} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onStep).toHaveBeenCalledWith('cli');
  });

  it('offers to connect GitHub and to come back to this step', () => {
    account.value = {};
    render(<Wizard {...base} mode="empty" step="source" onStep={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toHaveAttribute(
      'data-return',
      '/dashboard/canvas?wizard=source'
    );
    account.value = { github_install_id: '42' };
  });

  it('lists every action for an account with apps, and routes the others through an app', () => {
    const onPickExisting = vi.fn();
    render(
      <Wizard
        {...base}
        apps={['api-gateway', 'billing']}
        mode="new"
        step="start"
        onStep={vi.fn()}
        onPickExisting={onPickExisting}
      />
    );
    fireEvent.change(screen.getByLabelText('App'), { target: { value: 'billing' } });
    fireEvent.click(screen.getByRole('button', { name: /add a domain/i }));
    expect(onPickExisting).toHaveBeenCalledWith('billing', 'domain');
  });
});
