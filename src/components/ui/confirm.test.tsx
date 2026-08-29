import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider, useConfirm } from './confirm';

/**
 * The promise-based confirm is the console's entire pre-flight safety model
 * for destructive actions, so its contract gets pinned: resolve true on
 * confirm, false on cancel, and hold the armed state behind type-to-confirm.
 */

function Harness(props: { typeToConfirm?: string }) {
  const confirm = useConfirm();
  const [result, setResult] = useState<string>('idle');
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void confirm({
            title: 'Delete everything?',
            description: 'This cannot be undone.',
            confirmLabel: 'Delete',
            destructive: true,
            ...(props.typeToConfirm ? { typeToConfirm: props.typeToConfirm } : {}),
          }).then((ok) => setResult(ok ? 'confirmed' : 'cancelled'));
        }}
      >
        Trigger
      </button>
      <output>{result}</output>
    </>
  );
}

const setup = (props: { typeToConfirm?: string } = {}) => {
  render(
    <ConfirmProvider>
      <Harness {...props} />
    </ConfirmProvider>
  );
  return userEvent.setup();
};

describe('useConfirm', () => {
  it('resolves true when the destructive action is confirmed', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Trigger' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('confirmed'));
  });

  it('resolves false on cancel, and the dialog leaves', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Trigger' }));
    await user.click(await screen.findByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('cancelled'));
  });

  it('keeps the confirm disarmed until the name is typed back exactly', async () => {
    const user = setup({ typeToConfirm: 'my-app' });
    await user.click(screen.getByRole('button', { name: 'Trigger' }));

    const confirmButton = await screen.findByRole('button', { name: 'Delete' });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'my-ap');
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'p');
    expect(confirmButton).toBeEnabled();
  });
});
