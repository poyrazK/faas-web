import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SigningSecretEditor } from './signing-secret-editor';

it('requires a replacement and keeps a failed rotation open for retry', async () => {
  const user = userEvent.setup();
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error('Receiver update unavailable'))
    .mockResolvedValue({});
  const close = vi.fn();
  render(<SigningSecretEditor onSave={save} onClose={close} />);
  const input = screen.getByLabelText('Replacement signing secret');
  expect(input).toHaveAttribute('type', 'password');
  expect(screen.getByRole('button', { name: 'Replace secret' })).toBeDisabled();
  await user.type(input, 'owned-test-secret');
  await user.click(screen.getByRole('button', { name: 'Replace secret' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Receiver update unavailable');
  expect(close).not.toHaveBeenCalled();
  expect(input).toHaveValue('owned-test-secret');
  await user.click(screen.getByRole('button', { name: 'Replace secret' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(save).toHaveBeenNthCalledWith(2, 'owned-test-secret');
  expect(input).toHaveValue('');
});
