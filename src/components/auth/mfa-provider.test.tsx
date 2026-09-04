import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MfaProvider, useMfa } from './mfa-provider';

vi.mock('@/lib/api/queries', () => ({
  confirmMfa: vi.fn(),
  enrollMfa: vi.fn(),
  recoverMfa: vi.fn(),
  verifyMfa: vi.fn().mockResolvedValue({}),
}));

function Opener({ onVerified, onDismissed }: { onVerified: () => void; onDismissed: () => void }) {
  const { openMfa } = useMfa();
  return (
    <button type="button" onClick={() => openMfa('verify', { onVerified, onDismissed })}>
      step up
    </button>
  );
}

function renderWith(ui: React.ReactNode) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MfaProvider>{ui}</MfaProvider>
    </QueryClientProvider>
  );
}

describe('openMfa completion callbacks', () => {
  it('calls onVerified once after a successful verify', async () => {
    const onVerified = vi.fn();
    const onDismissed = vi.fn();
    renderWith(<Opener onVerified={onVerified} onDismissed={onDismissed} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /step up/i }));

    const code = await screen.findByRole('textbox');
    await user.type(code, '123456');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(onDismissed).not.toHaveBeenCalled();
  });

  it('calls onDismissed when the modal is closed without verifying', async () => {
    const onVerified = vi.fn();
    const onDismissed = vi.fn();
    renderWith(<Opener onVerified={onVerified} onDismissed={onDismissed} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /step up/i }));
    await screen.findByRole('textbox');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(onDismissed).toHaveBeenCalledTimes(1));
    expect(onVerified).not.toHaveBeenCalled();
  });
});
