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
