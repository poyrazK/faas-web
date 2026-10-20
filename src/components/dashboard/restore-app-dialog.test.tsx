import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from '@/test/api';
import { RestoreAppButton, RestoreAppDialog } from './restore-app-dialog';

afterEach(() => vi.restoreAllMocks());

const appId = '00000000-0000-4000-8000-000000000001';

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  );
}

/** What openapi-fetch hands back for a problem+json answer. */
function problem(status: number, code: string, title: string, detail?: string) {
  return {
    error: { status, code, title, detail },
    response: new Response(null, { status }),
  } as never;
}

const slugField = () => screen.getByLabelText('App slug') as HTMLInputElement;
const submit = () => screen.getByRole('button', { name: 'Restore app' });

describe('RestoreAppDialog', () => {
  it('refuses a slug the app-name rule rejects, without calling the API', async () => {
    const post = spyApi('POST');
    wrap(<RestoreAppDialog onClose={vi.fn()} onRestored={vi.fn()} />);
    await userEvent.type(slugField(), 'Not A Slug');
    await userEvent.click(submit());
    expect(screen.getByText(/Use 3–40 lowercase letters/)).toBeInTheDocument();
    expect(slugField()).toHaveAttribute('aria-invalid', 'true');
    expect(post).not.toHaveBeenCalled();
  });

  it('restores the typed slug, says so, and hands it on', async () => {
    const post = spyApi('POST').mockResolvedValue({
      data: { id: appId, slug: 'old-api', status: 'undeployed' },
      response: new Response(),
    } as never);
    const onRestored = vi.fn();
    wrap(<RestoreAppDialog onClose={vi.fn()} onRestored={onRestored} />);
    await userEvent.type(slugField(), 'old-api');
    await userEvent.click(submit());
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith('old-api'));
    expect(post).toHaveBeenCalledWith(
      '/v1/apps/{slug}/restore',
      expect.objectContaining({ params: { path: { slug: 'old-api' } } })
    );
    expect(await screen.findByText('old-api restored')).toBeInTheDocument();
  });

  it.each([
    ['not_found', 404, /No deleted app named "ghost-app"/],
    ['app_not_restorable', 409, /7-day grace window has ended/],
    ['conflict', 409, /changed since you looked it up\. Check Apps and try again/],
    ['mfa_required', 403, /Set up multi-factor authentication/],
    ['plan_limit_apps', 403, /apps allowed on your plan/i],
  ])('explains %s in its own words and keeps the dialog open', async (code, status, words) => {
    spyApi('POST').mockResolvedValue(problem(status, code, 'Title from the API') as never);
    const onClose = vi.fn();
    const onRestored = vi.fn();
    wrap(<RestoreAppDialog onClose={onClose} onRestored={onRestored} />);
    await userEvent.type(slugField(), 'ghost-app');
    await userEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
    expect(slugField()).toHaveValue('ghost-app');
    expect(onClose).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('shows the API detail for a code it has no wording for', async () => {
    spyApi('POST').mockResolvedValue(
      problem(429, 'quota_exhausted', 'Quota exhausted', 'The monthly allowance is spent.')
    );
    wrap(<RestoreAppDialog onClose={vi.fn()} onRestored={vi.fn()} />);
    await userEvent.type(slugField(), 'ghost-app');
    await userEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('The monthly allowance is spent.');
  });

  it('does not branch on the status: a 404 with another code is not "no deleted app"', async () => {
    spyApi('POST').mockResolvedValue(problem(404, 'something_else', 'Odd', 'Odd thing happened.'));
    wrap(<RestoreAppDialog onClose={vi.fn()} onRestored={vi.fn()} />);
    await userEvent.type(slugField(), 'ghost-app');
    await userEvent.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Odd thing happened.');
    expect(alert).not.toHaveTextContent(/No deleted app/);
  });
});

describe('RestoreAppButton', () => {
  it('opens the dialog from "Restore a deleted app" and explains the window', async () => {
    wrap(<RestoreAppButton onRestored={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Restore a deleted app' }));
    const dialog = screen.getByRole('dialog', { name: 'Restore a deleted app' });
    expect(dialog).toHaveTextContent(/7 days/);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
