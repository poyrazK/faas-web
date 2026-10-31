import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SecretValueField } from './secret-value-field';

const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADAN\nBgkqhkiG9w0B\n-----END PRIVATE KEY-----';

function Harness({ onValue }: { onValue: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <SecretValueField
      label="Value"
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

describe('SecretValueField', () => {
  it('masks a single-line value', () => {
    render(<Harness onValue={vi.fn()} />);
    expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'password');
  });

  it('keeps the line breaks of a pasted multi-line secret', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.click(screen.getByLabelText('Value'));
    await user.paste(PEM);
    expect(onValue).toHaveBeenLastCalledWith(PEM);
    expect(screen.getByLabelText('Value').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Value')).toHaveValue(PEM);
  });

  it('can be switched to multi-line before typing', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.click(screen.getByRole('button', { name: 'Multi-line value' }));
    await user.type(screen.getByLabelText('Value'), 'line one{Enter}line two');
    expect(onValue).toHaveBeenLastCalledWith('line one\nline two');
  });

  it('goes back to masked when the parent clears the value', async () => {
    const user = userEvent.setup();
    function Resettable() {
      const [value, setValue] = useState('');
      return (
        <>
          <SecretValueField label="Value" value={value} onChange={setValue} />
          <button type="button" onClick={() => setValue('')}>
            reset
          </button>
        </>
      );
    }
    render(<Resettable />);
    await user.click(screen.getByLabelText('Value'));
    await user.paste(PEM);
    expect(screen.getByLabelText('Value').tagName).toBe('TEXTAREA');
    await user.click(screen.getByRole('button', { name: 'reset' }));
    expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'password');
  });

  it('stays multi-line when the user empties the textarea by hand', async () => {
    const user = userEvent.setup();
    render(<Harness onValue={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Multi-line value' }));
    await user.type(screen.getByLabelText('Value'), 'ab');
    await user.clear(screen.getByLabelText('Value'));
    expect(screen.getByLabelText('Value').tagName).toBe('TEXTAREA');
  });
});
