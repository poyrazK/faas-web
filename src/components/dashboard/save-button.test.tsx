import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SaveButton } from './save-button';

it('requires explicit success and never treats a completed or rejected request as saved', () => {
  const { container, rerender } = render(
    <SaveButton saved={false} busy>
      Save changes
    </SaveButton>
  );
  expect(screen.getByRole('button')).toBeDisabled();
  rerender(<SaveButton saved={false}>Save changes</SaveButton>);
  expect(container.querySelector('[data-saved]')).toBeNull();
  rerender(<SaveButton saved>Save changes</SaveButton>);
  expect(container.querySelector('[data-saved="true"]')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Save changes — Saved' })).toBeEnabled();
  rerender(
    <SaveButton saved busy>
      Save changes
    </SaveButton>
  );
  expect(container.querySelector('[data-saved]')).toBeNull();
});

it('does not delay or duplicate the action while displaying an acknowledgement', async () => {
  const onClick = vi.fn();
  render(
    <SaveButton saved onClick={onClick}>
      Save changes
    </SaveButton>
  );
  await userEvent.click(screen.getByRole('button', { name: 'Save changes — Saved' }));
  expect(onClick).toHaveBeenCalledTimes(1);
});
