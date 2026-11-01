import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';

const cap = vi.hoisted(() => ({ access: 'on' as string }));
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: cap.access, refresh: vi.fn() }),
}));
vi.mock('@/components/dashboard/release-webhooks', () => ({
  ReleaseWebhooks: () => <p>Release receivers</p>,
}));

const { Route } = await import('./dashboard.release-webhooks');
const Page = (Route as unknown as { component: () => React.ReactNode }).component;

beforeEach(() => {
  cap.access = 'on';
});

describe('/dashboard/release-webhooks', () => {
  it('renders the receivers when the capability is on, with a page title', () => {
    render(<Page />);
    expect(screen.getByText('Release receivers')).toBeInTheDocument();
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();
    expect(head.meta.some((m) => m.title?.startsWith('Release webhooks'))).toBe(true);
  });

  it.each([
    ['off', 'Not enabled for this account'],
    ['plan-not-entitled', 'Not included in your plan'],
  ])('explains itself without calling the API when access is %s', (access, message) => {
    cap.access = access;
    const get = spyApi('GET');
    render(<Page />);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Release receivers')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
