import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { ErrorState, InlinePhase } from './primitives';

const notVerified = new ApiError({
  title: 'Domain not verified',
  status: 409,
  code: 'domain_not_verified',
  detail: 'The TXT record was not found.',
  hint: 'Add the TXT record, then retry verification.',
  docs_url: 'https://gregale.dev/docs/custom-domains#verify',
});

function expectHelp(container: HTMLElement) {
  const scope = within(container);
  expect(scope.getByText('The TXT record was not found.')).toBeInTheDocument();
  expect(scope.getByText('Add the TXT record, then retry verification.')).toBeInTheDocument();
  expect(scope.getByText('domain_not_verified')).toBeInTheDocument();
  expect(scope.getByRole('button', { name: /Copy: error code/ })).toBeInTheDocument();
  const docs = scope.getByRole('link', { name: /Docs/ });
  expect(docs).toHaveAttribute('href', '/docs/custom-domains#verify');
  expect(docs).toHaveAttribute('target', '_blank');
}

describe('API error help', () => {
  it('shows the code, hint and docs link in a failed panel', () => {
    render(<ErrorState error={notVerified} />);
    expectHelp(screen.getByRole('alert'));
  });

  it('shows the code, hint and docs link in an inline failure', () => {
    render(<InlinePhase phase="error" error={notVerified} />);
    expectHelp(screen.getByRole('alert'));
  });

  it('shows the code, hint and docs link in an error toast', async () => {
    let show: ReturnType<typeof useToast>['toast'] = () => {};
    function Trigger() {
      show = useToast().toast;
      return null;
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    await act(async () => show({ kind: 'error', title: 'Could not verify', error: notVerified }));
    expect(screen.getByText('Could not verify')).toBeInTheDocument();
    expectHelp(screen.getByRole('alert'));
  });

  it('adds nothing when the API never answered', () => {
    render(<ErrorState error={new TypeError('Failed to fetch')} />);
    expect(screen.queryByRole('link', { name: /Docs/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy: error code/ })).not.toBeInTheDocument();
  });
});
