import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyIconButton } from './copy-button';

/** jsdom has no clipboard; each test states what the platform does. */
function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CopyIconButton', () => {
  it('copies the text and announces the confirmed state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // After userEvent.setup(): it installs its own clipboard stub, and the
    // test needs this one to be the one the component reaches.
    const user = userEvent.setup();
    mockClipboard(writeText);
    render(<CopyIconButton text="gregale deploy" label="gregale deploy" />);

    await user.click(screen.getByRole('button', { name: 'Copy: gregale deploy' }));

    expect(writeText).toHaveBeenCalledWith('gregale deploy');
    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
  });

  it('stays quiet when clipboard access is denied — no false "Copied"', async () => {
    const user = userEvent.setup();
    mockClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    render(<CopyIconButton text="secret" label="secret" />);

    await user.click(screen.getByRole('button', { name: 'Copy: secret' }));

    // The live region must not claim a copy that never happened.
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  });
});
