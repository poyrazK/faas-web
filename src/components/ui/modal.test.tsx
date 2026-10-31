import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { Modal } from './modal';

it('Escape dismisses only the topmost modal and keeps the parent scroll lock', async () => {
  const originalOverflow = document.body.style.overflow;
  function Stack() {
    const [parent, setParent] = useState(true);
    const [child, setChild] = useState(false);
    return (
      <>
        <Modal open={parent} title="Release details" onClose={() => setParent(false)}>
          <button onClick={() => setChild(true)}>Confirm action</button>
        </Modal>
        <Modal open={child} title="Confirm release action" onClose={() => setChild(false)}>
          Are you sure?
        </Modal>
      </>
    );
  }
  render(<Stack />);
  const trigger = screen.getByRole('button', { name: 'Confirm action' });
  await userEvent.click(trigger);
  expect(screen.getAllByRole('dialog')).toHaveLength(2);
  await userEvent.keyboard('{Escape}');
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Confirm release action' })).not.toBeInTheDocument()
  );
  expect(screen.getByRole('dialog', { name: 'Release details' })).toBeInTheDocument();
  expect(document.body.style.overflow).toBe('hidden');
  expect(trigger).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(document.body.style.overflow).toBe(originalOverflow);
});

it('opens as a right-side drawer with the same Escape and focus behaviour', async () => {
  function Drawer() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open wake</button>
        <Modal open={open} title="Wake" placement="right" onClose={() => setOpen(false)}>
          <button>Inside</button>
        </Modal>
      </>
    );
  }
  render(<Drawer />);
  const trigger = screen.getByRole('button', { name: 'Open wake' });
  await userEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Wake' });
  expect(dialog).toHaveAttribute('data-placement', 'right');
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});
